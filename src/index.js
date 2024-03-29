import { NanoresourcePromise } from 'nanoresource-promise/emitter2'
import fastq from 'fastq'

import Request from './request.js'
import { createCodec, createPackr } from './codec.js'
import {
  NM_ERR_CLOSE,
  NM_ERR_NOT_OPEN,
  NM_ERR_MESSAGE,
  NM_ERR_REMOTE_RESPONSE
} from './errors.js'
import IdGenerator from './id-generator.js'

const VOID_RESPONSE = Symbol('VOID_RESPONSE')
const kRequests = Symbol('nanomessage.requests')
const kInQueue = Symbol('nanomessage.inqueue')
const kOutQueue = Symbol('nanomessage.outqueue')
const kUnsubscribe = Symbol('nanomessage.unsubscribe')
const kOpen = Symbol('nanomessage.open')
const kClose = Symbol('nanomessage.close')
const kFastCheckOpen = Symbol('nanomessage.fastcheckopen')
const kTimeout = Symbol('nanomessage.timeout')
const kIdGenerator = Symbol('nanomessage.idgenerator')
const kCodec = Symbol('nanomessage.codec')

function inWorker ({ info, onMessage }, done) {
  this[kFastCheckOpen]()
    .then(() => onMessage(info.data, info))
    .catch(_err => {
      if (_err.isNanoerror) return _err
      const err = NM_ERR_REMOTE_RESPONSE.from(_err)
      err.metadata = _err.metadata
      return err
    })
    .then(async data => {
      if (VOID_RESPONSE === data || this.closed || this.closing) return

      info.response = true
      info.responseData = data
      info.error = !!(data?.isNanoerror)

      await this._send(this[kCodec].encode(info), info)

      if (info.error) throw data
    })
    .then(() => done())
    .catch(err => {
      if (err.isNanoerror) return done(err)
      done(NM_ERR_MESSAGE.from(err))
    })
}

function outWorker (request, done) {
  const info = request.info()
  this[kFastCheckOpen]()
    .then(() => {
      if (request.finished) return
      request.start()
      return this._send(this[kCodec].encode(info), info)
    })
    .then(() => {
      if (request.finished) return
      return request.promise
    })
    .then(data => done(null, data))
    .catch(err => done(err))
}

export * from './errors.js'

export { createPackr, VOID_RESPONSE }
export class Nanomessage extends NanoresourcePromise {
  /**
   * Creates an instance of Nanomessage.
   * @param {Object} [opts={}]
   * @param {(buf: Buffer, info: Object) => Promise|undefined} [opts.send]
   * @param {function} [opts.subscribe]
   * @param {(data: Object, info: Object) => Promise<*>} [opts.onMessage]
   * @param {function} [opts.open]
   * @param {function} [opts.close]
   * @param {number} [opts.timeout]
   * @param {Object} [opts.valueEncoding]
   * @param {({ incoming: number, outgoing: number }|number)} [opts.concurrency]
   * @memberof Nanomessage
   */
  constructor (opts = {}) {
    super()

    const { send, subscribe, onMessage, open, close, timeout, valueEncoding, concurrency = 256 } = opts

    if (send) this._send = send
    if (subscribe) this._subscribe = subscribe
    if (onMessage) this.setMessageHandler(onMessage)
    if (open) this[kOpen] = open
    if (close) this[kClose] = close
    this.setRequestTimeout(timeout)

    this[kCodec] = createCodec(valueEncoding)

    this[kInQueue] = fastq(this, inWorker, 1)
    this[kOutQueue] = fastq(this, outWorker, 1)
    this.setConcurrency(concurrency)

    this[kRequests] = new Map()
    this[kIdGenerator] = new IdGenerator(() => this[kRequests].size + 1)
  }

  /**
   * @readonly
   * @type {Object}
   */
  get codec () {
    return this[kCodec]
  }

  /**
   * @readonly
   * @type {Array<Request>}
   */
  get requests () {
    return Array.from(this[kRequests].values())
  }

  /**
   * @readonly
   * @type {number}
   */
  get inflightRequests () {
    return this[kOutQueue].running()
  }

  /**
   * @readonly
   * @type {number}
   */
  get requestTimeout () {
    return this[kTimeout]
  }

  /**
   * @readonly
   * @type {Object}
   */
  get concurrency () {
    return {
      incoming: this[kInQueue].concurrency,
      outgoing: this[kOutQueue].concurrency
    }
  }

  /**
   * @param {number} timeout
   * @returns {Nanomessage}
   */
  setRequestTimeout (timeout) {
    this[kTimeout] = timeout
    return this
  }

  /**
   * @param {({ incoming: number, outgoing: number }|number)} value
   * @returns {Nanomessage}
   */
  setConcurrency (value) {
    if (typeof value === 'number') {
      this[kInQueue].concurrency = value
      this[kOutQueue].concurrency = value
    } else {
      this[kInQueue].concurrency = value.incoming || this[kInQueue].concurrency
      this[kOutQueue].concurrency = value.outgoing || this[kOutQueue].concurrency
    }
    return this
  }

  /**
   * Send a request and wait for the response.
   *
   * @param {*} data
   * @param {Object} [opts]
   * @param {number} [opts.timeout]
   * @param {AbortSignal} [opts.signal]
   * @param {function} [opts.onCancel]
   * @param {*} [opts.context]
   * @returns {Promise<*>}
   */
  async request (data, opts = {}) {
    if (this.closed || this.closing) throw new NM_ERR_CLOSE()

    const request = new Request({ id: this[kIdGenerator].get(), data, timeout: opts.timeout || this[kTimeout], signal: opts.signal, context: opts.context, onCancel: opts.onCancel })
    const info = request.info()

    this[kRequests].set(request.id, request)
    request.onFinish(() => {
      this[kRequests].delete(request.id)
      this[kIdGenerator].release(request.id)
    })

    this.emit('request-created', info)

    this[kOutQueue].push(request, (err, data) => {
      if (err) request.reject(err)
      info.response = true
      info.responseData = data
      this.emit('request-ended', err, info)
    })

    return request.promise
  }

  /**
   * Send a ephemeral message.
   *
   * @param {*} data
   * @param {Object} [opts]
   * @param {Object} [opts.context]
   * @returns {Promise}
   */
  send (data, opts = {}) {
    return this[kFastCheckOpen]()
      .then(() => {
        const info = Request.info({ id: 0, data, context: opts.context })
        return this._send(this[kCodec].encode(info), info)
      })
  }

  /**
   * @param {(data: Object, info: Object) => Promise<*>} onMessage
   * @returns {Nanomessage}
   */
  setMessageHandler (onMessage) {
    this._onMessage = onMessage
    return this
  }

  /**
   * @param {Buffer} buf
   * @param {Object} [opts]
   * @param {function} [opts.onMessage]
   * @param {*} [opts.context]
   * @returns {Promise}
   */
  async processIncomingMessage (buf, opts = {}) {
    if (this.closed || this.closing) return

    const { onMessage = this._onMessage, context } = opts

    const info = this[kCodec].decode(buf, context)

    // resolve response
    if (info.response) {
      const request = this[kRequests].get(info.id)
      if (request) {
        if (info.error) {
          request.reject(info.data)
        } else {
          request.resolve(info.data)
        }
      }
      return new Promise(resolve => resolve(info))
    }

    this.emit('message', info)

    if (info.ephemeral) {
      return this[kFastCheckOpen]()
        .then(() => onMessage(info.data, info))
        .then(() => info)
        .catch(err => {
          if (!err.isNanoerror) {
            err = NM_ERR_MESSAGE.from(err)
          }
          this.emit('error-message', err, info)
          throw err
        })
    }

    return new Promise((resolve, reject) => this[kInQueue].push({ info, onMessage }, err => {
      if (err) {
        this.emit('error-message', err, info)
        reject(err)
      } else {
        resolve(info)
      }
    }))
  }

  /**
   * @abstract
   * @param {Buffer} buf
   * @param {Object} info
   * @returns {Promise|undefined}
   */
  async _send (buf, info) {
    throw new Error('_send not implemented')
  }

  /**
   * @abstract
   * @param {Object} data
   * @param {Object} info
   * @returns {Promise<*>}
   */
  async _onMessage (data, info) {}

  async _open () {
    await (this[kOpen] && this[kOpen]())
    const opts = {
      onMessage: this._onMessage.bind(this)
    }
    const processIncomingMessage = buf => this.processIncomingMessage(buf, opts)
    this[kUnsubscribe] = this._subscribe && this._subscribe(processIncomingMessage)
  }

  async _close () {
    if (this[kUnsubscribe]) this[kUnsubscribe]()

    const requestsToClose = []
    this[kRequests].forEach(request => request.reject(new NM_ERR_CLOSE()))
    this[kRequests].clear()

    this[kInQueue] && this[kInQueue].kill()
    this[kOutQueue] && this[kOutQueue].kill()

    await (this[kClose] && this[kClose]())
    await Promise.all(requestsToClose)
  }

  async [kFastCheckOpen] () {
    if (this.closed || this.closing) throw new NM_ERR_CLOSE()
    if (this.opening) return this.open()
    if (!this.opened) throw new NM_ERR_NOT_OPEN()
  }
}
