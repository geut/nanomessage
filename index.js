const assert = require('nanocustomassert')
const { NanoresourcePromise } = require('nanoresource-promise/emitter')
const fastq = require('fastq')
const varint = require('varint')
const bufferJson = require('buffer-json-encoding')

const Request = require('./lib/request')
const {
  NMSG_ERR_ENCODE,
  NMSG_ERR_DECODE,
  NMSG_ERR_RESPONSE,
  NMSG_ERR_INVALID_REQUEST,
  NMSG_ERR_TIMEOUT,
  NMSG_ERR_NOT_OPEN,
  NMSG_ERR_CLOSE
} = require('./lib/errors')

const kRequests = Symbol('nanomessage.requests')
const kInQueue = Symbol('nanomessage.inqueue')
const kOutQueue = Symbol('nanomessage.outqueue')
const kInWorker = Symbol('nanomessage.inworker')
const kOutWorker = Symbol('nanomessage.outworker')
const kUnsubscribe = Symbol('nanomessage.unsubscribe')
const kMessageHandler = Symbol('nanomessage.messagehandler')
const kClose = Symbol('nanomessage.close')
const kFastCheckOpen = Symbol('nanomessage.fastcheckopen')
const kTimeout = Symbol('nanomessage.timeout')
const kIdGenerator = Symbol('nanomessage.idgenerator')

const DEFAULT_CODEC = {
  encode (data) {
    return bufferJson.encode({ data })
  },
  decode (buf) {
    return bufferJson.decode(buf).data
  }
}

class IdGenerator {
  constructor (generate) {
    this._generate = generate
    this._free = []
  }

  get () {
    if (!this._free.length) {
      return this._generate()
    }

    return this._free.pop()
  }

  release (id) {
    this._free.push(id)
  }
}

class Nanomessage extends NanoresourcePromise {
  constructor (opts = {}) {
    super()

    const { subscribe, send, onMessage, close, timeout = Infinity, valueEncoding = DEFAULT_CODEC } = opts
    let { concurrency = {} } = opts

    assert(this._send || send, 'send is required')

    if (send) this._send = (buf, info) => send(buf, info)
    if (subscribe) this._subscribe = (next) => subscribe(next)
    if (onMessage) this.setMessageHandler(onMessage)
    if (close) this[kClose] = () => close()
    this[kTimeout] = timeout

    this.codec = {
      encode: val => valueEncoding.encode(val),
      decode: buf => valueEncoding.decode(buf)
    }

    if (typeof concurrency === 'number') {
      concurrency = {
        incoming: concurrency,
        outgoing: concurrency
      }
    }

    this[kInQueue] = fastq(this, this[kInWorker], concurrency.incoming || Infinity)
    this[kOutQueue] = fastq(this, this[kOutWorker], concurrency.outgoing || Infinity)
    this[kRequests] = new Map()
    this[kIdGenerator] = new IdGenerator(() => this[kRequests].size + 1)
  }

  get requests () {
    return Array.from(this[kRequests].values())
  }

  get inflightRequests () {
    return this[kOutQueue].running()
  }

  request (data) {
    const request = new Request({ id: this[kIdGenerator].get(), data })
    const info = request.info()

    this[kRequests].set(request.id, request)
    request.onFinish(err => {
      this[kRequests].delete(request.id)
      this[kIdGenerator].release(request.id)
      this.emit('request-ended', err, info)
    })

    this.emit('request-created', info)

    this[kOutQueue].push(request)

    return request.promise
  }

  send (data) {
    return this[kFastCheckOpen]()
      .then(() => {
        const info = Request.info({ id: 0, data })
        this._send(this.encode(info), info)
      })
  }

  setMessageHandler (onMessage) {
    this._onMessage = onMessage
    return this
  }

  encode (info) {
    try {
      const data = this.codec.encode(info.data)
      const buf = Buffer.allocUnsafe(
        varint.encodingLength(data.length) +
        data.length +
        varint.encodingLength(info.id) +
        varint.encodingLength(1)
      )
      let offset = 0
      varint.encode(data.length, buf, offset)
      offset += varint.encode.bytes
      data.copy(buf, offset)
      offset += data.length
      varint.encode(info.id, buf, offset)
      offset += varint.encode.bytes
      varint.encode(info.response ? 1 : 0, buf, offset)
      return buf
    } catch (err) {
      throw new NMSG_ERR_ENCODE(err.message)
    }
  }

  decode (buf) {
    try {
      const request = {}
      let offset = 0
      const dataLength = varint.decode(buf, 0)
      offset += varint.decode.bytes
      request.data = this.codec.decode(buf.slice(offset, offset + dataLength))
      offset += dataLength
      request.id = varint.decode(buf, offset)
      offset += varint.decode.bytes
      request.response = !!varint.decode(buf, offset)
      return request
    } catch (err) {
      if (err instanceof NMSG_ERR_INVALID_REQUEST) {
        throw err
      }
      throw new NMSG_ERR_DECODE(err.message)
    }
  }

  async _onMessage () {
    throw new Error('missing handler for incoming requests')
  }

  async _open () {
    assert(this._subscribe, 'subscribe is required')

    this[kUnsubscribe] = this._subscribe(this[kMessageHandler].bind(this))
  }

  async _close () {
    if (this[kUnsubscribe]) this[kUnsubscribe]()

    const requestsToClose = []
    this[kRequests].forEach(request => request.reject(new NMSG_ERR_CLOSE()))
    this[kRequests].clear()

    this[kInQueue].kill()
    this[kOutQueue].kill()

    await (this[kClose] && this[kClose]())
    await Promise.all(requestsToClose)
  }

  async [kFastCheckOpen] () {
    if (this.closed || this.closing) throw new NMSG_ERR_CLOSE()
    if (this.opening) return this.open()
    if (!this.opened) throw new NMSG_ERR_NOT_OPEN()
  }

  [kMessageHandler] (message) {
    if (this.closed || this.closing) return

    const info = Request.info(this.decode(message))

    // resolve response
    if (info.response) {
      const request = this[kRequests].get(info.id)
      if (request) request.resolve(info.data)
      return
    }

    if (info.ephemeral) {
      this.emit('request-received', info)
      this[kFastCheckOpen]()
        .then(() => this._onMessage(info.data, info))
        .catch(err => {
          const rErr = new NMSG_ERR_RESPONSE(err.message)
          rErr.stack = err.stack || rErr.stack
          this.emit('response-error', rErr, info)
        })
      return
    }

    info.response = true
    this.emit('request-received', info)

    this[kInQueue].push(info, (err) => {
      if (err) {
        const rErr = new NMSG_ERR_RESPONSE(err.message)
        rErr.stack = err.stack || rErr.stack
        this.emit('response-error', rErr, info)
      }
    })
  }

  [kInWorker] (info, done) {
    this[kFastCheckOpen]()
      .then(() => this._onMessage(info.data, info))
      .then(data => {
        if (this.closed || this.closing) return done()

        info.responseData = data

        this._send(this.encode({
          id: info.id,
          response: info.response,
          data
        }), info)

        done()
      })
      .catch(err => done(err))
  }

  [kOutWorker] (request, done) {
    const info = request.info()
    this[kFastCheckOpen]()
      .then(() => {
        if (request.finished) return
        this._send(this.encode(info), info)
        return request.promise
      })
      .then(() => done())
      .catch(err => done(err))
  }
}

const nanomessage = (opts) => new Nanomessage(opts)
nanomessage.Nanomessage = Nanomessage
nanomessage.errors = require('./lib/errors')
module.exports = nanomessage
