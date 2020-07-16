const assert = require('nanocustomassert')
const { NanoresourcePromise } = require('nanoresource-promise/emitter')
const { default: PQueue } = require('p-queue')
const fastq = require('fastq')

const Request = require('./lib/request')
const defaultCodec = require('./lib/codec')
const schema = require('./lib/schema')
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

class Nanomessage extends NanoresourcePromise {
  constructor (opts = {}) {
    super()

    const { subscribe, send, onMessage, close, timeout = Infinity, valueEncoding = defaultCodec } = opts
    let { concurrency = {} } = opts

    assert(this._send || send, 'send is required')

    if (send) this._send = (buf, info) => send(buf, info)
    if (subscribe) this._subscribe = (next) => subscribe(next)
    if (onMessage) this.setMessageHandler(onMessage)
    if (close) this[kClose] = () => close()

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

    this.test = fastq(this, (request, cb) => {
      const info = request.info()
      this[kFastCheckOpen]().then(() => {
        this._send(this.encode(info), info)
        cb()
      })
    }, Infinity)

    this.test2 = fastq(this, (request, cb) => {
      const info = request.info()
      this[kFastCheckOpen]()
        .then(() => this._onMessage(info.data, info))
        .then(data => {
          info.responseData = data
          this._send(this.encode({
            id: info.id,
            response: info.response,
            data
          }), info)
          request.resolve()
          cb()
        })
    }, Infinity)

    this[kRequests] = new Map()
  }

  get requests () {
    return Array.from(this[kRequests].values())
  }

  get inflightRequests () {
    return this[kOutQueue].running()
  }

  request (data) {
    const request = new Request({ data })
    const info = request.info()

    this[kRequests].set(request.id, request)

    this[kOutQueue].push(request, err => {
      this[kRequests].delete(request.id)
      this.emit('request-ended', err, info)
    })

    this.emit('request-created', info)

    return request.promise
  }

  send (data) {
    return this[kFastCheckOpen]()
      .then(() => {
        const info = Request.info({ id: Request.uuid(), data, ephemeral: true })
        this._send(this.encode(info), info)
      })
  }

  setMessageHandler (onMessage) {
    this._onMessage = onMessage
    return this
  }

  encode (info) {
    try {
      return schema.Request.encode({
        id: info.id,
        response: info.response,
        ephemeral: info.ephemeral,
        data: this.codec.encode(info.data)
      })
    } catch (err) {
      throw new NMSG_ERR_ENCODE(err.message)
    }
  }

  decode (buf) {
    try {
      const request = schema.Request.decode(buf)
      if (!request.id) {
        const err = new NMSG_ERR_INVALID_REQUEST()
        err.request = request
        throw err
      }
      request.data = this.codec.decode(request.data)
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
    this[kRequests].forEach(request => {
      requestsToClose.push(request.promise.catch(() => {}))
      request.reject(new NMSG_ERR_CLOSE())
    })
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
    const { id, data, response, ephemeral } = this.decode(message)

    let info = null

    if (ephemeral) {
      info = Request.info({ id, data, ephemeral })
      this.emit('request-received', info)
      this[kFastCheckOpen]()
        .then(() => this._onMessage(info.data, info))
        .catch(err => {
          const rErr = new NMSG_ERR_RESPONSE(err.message)
          rErr.stack = err.stack
          this.emit('response-error', rErr, info)
        })
      return
    }

    let request = this[kRequests].get(id)

    // resolve response
    if (response) {
      if (request) request.resolve(data)
      return
    }

    if (request) {
      // request already beeing process
      return
    }

    // create a request response
    request = new Request({ id, data, response: true })
    info = request.info()

    this[kRequests].set(request.id, request)

    this.emit('request-received', info)

    this[kInQueue].push(request, (err) => {
      this[kRequests].delete(request.id)
      if (err) return request.reject(err)
      request.resolve()
    })

    request.promise.catch(err => {
      const rErr = new NMSG_ERR_RESPONSE(err.message)
      rErr.stack = err.stack
      this.emit('response-error', rErr, info)
    })
  }

  [kInWorker] (request, done) {
    const info = request.info()
    this[kFastCheckOpen]()
      .then(() => {
        if (request.finished) return
        return this._onMessage(info.data, info)
      })
      .then(data => {
        if (request.finished || this.closed || this.closing) return
        info.responseData = data
        this._send(this.encode({
          id: info.id,
          response: info.response,
          data
        }), info)
        done()
      })
      .catch((err) => done(err))
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
      .catch((err) => done(err))
  }
}

const nanomessage = (opts) => new Nanomessage(opts)
nanomessage.Nanomessage = Nanomessage
nanomessage.errors = require('./lib/errors')
module.exports = nanomessage
