const assert = require('nanocustomassert')
const { NanoresourcePromise } = require('nanoresource-promise/emitter')
const fastq = require('fastq')

const Request = require('./lib/request')
const createCodec = require('./lib/codec')
const {
  NMSG_ERR_RESPONSE,
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
const kOpen = Symbol('nanomessage.open')
const kClose = Symbol('nanomessage.close')
const kFastCheckOpen = Symbol('nanomessage.fastcheckopen')
const kTimeout = Symbol('nanomessage.timeout')
const kIdGenerator = Symbol('nanomessage.idgenerator')
const kCodec = Symbol('nanomessage.codec')

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

    const { subscribe, send, onMessage, open, close, timeout, valueEncoding } = opts
    const { concurrency = {} } = opts

    if (send) this._send = send
    if (subscribe) this._subscribe = subscribe
    if (onMessage) this.setMessageHandler(onMessage)
    if (open) this[kOpen] = open
    if (close) this[kClose] = close
    this.setRequestTimeout(timeout)

    this[kCodec] = createCodec(valueEncoding)

    this[kInQueue] = fastq(this, this[kInWorker], 256)
    this[kOutQueue] = fastq(this, this[kOutWorker], 256)
    this.setConcurrency(concurrency)

    this[kRequests] = new Map()
    this[kIdGenerator] = new IdGenerator(() => this[kRequests].size + 1)
  }

  get codec () {
    return this[kCodec]
  }

  get requests () {
    return Array.from(this[kRequests].values())
  }

  get inflightRequests () {
    return this[kOutQueue].running()
  }

  get requestTimeout () {
    return this[kTimeout]
  }

  get concurrency () {
    return {
      incoming: this[kInQueue].concurrency,
      outgoing: this[kOutQueue].concurrency
    }
  }

  setRequestTimeout (timeout) {
    this[kTimeout] = timeout
  }

  setConcurrency (value) {
    if (typeof value === 'number') {
      this[kInQueue].concurrency = value
      this[kOutQueue].concurrency = value
    } else {
      this[kInQueue].concurrency = value.incoming || this[kInQueue].concurrency
      this[kOutQueue].concurrency = value.outgoing || this[kOutQueue].concurrency
    }
  }

  request (data) {
    const request = new Request({ id: this[kIdGenerator].get(), data, timeout: this[kTimeout] })
    const info = request.info()

    this[kRequests].set(request.id, request)
    request.onFinish(() => {
      this[kRequests].delete(request.id)
      this[kIdGenerator].release(request.id)
    })

    this.emit('request-created', info)

    this[kOutQueue].push(request, (err, data) => {
      info.response = true
      info.responseData = data
      this.emit('request-ended', err, info)
    })

    return request.promise
  }

  send (data) {
    return this[kFastCheckOpen]()
      .then(() => {
        const info = Request.info({ id: 0, data })
        this._send(this[kCodec].encode(info), info)
      })
  }

  setMessageHandler (onMessage) {
    this._onMessage = onMessage
    return this
  }

  async _onMessage () {
    throw new Error('missing handler for incoming requests')
  }

  async _open () {
    assert(this._subscribe, 'subscribe is required')
    await (this[kOpen] && this[kOpen]())
    this[kUnsubscribe] = this._subscribe(this[kMessageHandler].bind(this))
  }

  async _close () {
    if (this[kUnsubscribe]) this[kUnsubscribe]()

    const requestsToClose = []
    this[kRequests].forEach(request => request.reject(new NMSG_ERR_CLOSE()))
    this[kRequests].clear()

    this[kInQueue] && this[kInQueue].kill()
    this[kOutQueue] && this[kOutQueue].kill()

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

    const info = Request.info(this[kCodec].decode(message))

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

    this[kInQueue].push(info, err => {
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

        this._send(this[kCodec].encode({
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
        request.start()
        this._send(this[kCodec].encode(info), info)
        return request.promise
      })
      .then(data => done(null, data))
      .catch(err => done(err))
  }
}

const nanomessage = (opts) => new Nanomessage(opts)
nanomessage.Nanomessage = Nanomessage
nanomessage.errors = require('./lib/errors')
nanomessage.BJSON = require('./lib/buffer-json')
module.exports = nanomessage
