/**
 * @typedef {object} NanomessageOptions
 * @property {send} [opts.send]
 * @property {subscribe} [opts.subscribe]
 * @property {onMessage} [opts.onMessage]
 * @property {close} [opts.close]
 * @property {number} [opts.timeout=10000]
 * @property {Codec} [opts.codec=json]
*/

/**
 * Compatible codec: https://github.com/mafintosh/codecs
 * @typedef {object} Codec
 * @property {!function} encode
 * @property {!function} decode
 */

/**
 * Subscribe for the incoming data.
 * @callback subscribe
 * @param {!function} onData
 * @returns {?function} - Unsubscribe function.
 */

/**
 * How to send the data.
 * @callback send
 * @param {Buffer}
 * @param {Object} opts
 * @param {Function} opts.onCancel
 * @returns {Promise}
 */

/**
 * Request handler.
 * @callback onMessage
 * @param {!Buffer} data
 * @param {Object} opts
 * @param {boolean} opts.ephemeral
 * @param {Function} opts.onCancel
 * @returns {Promise<*>} - Response with any data.
 */

/**
 * Runs and wait for a close operation.
 * @callback close
 * @returns {Promise<*>} - Response with any data.
 */

const assert = require('nanocustomassert')
const { NanoresourcePromise } = require('nanoresource-promise/emitter')
const { default: PQueue } = require('p-queue')

const Request = require('./lib/request')
const defaultCodec = require('./lib/codec')
const {
  NMSG_ERR_ENCODE,
  NMSG_ERR_DECODE,
  NMSG_ERR_RESPONSE,
  NMSG_ERR_INVALID_REQUEST,
  NMSG_ERR_TIMEOUT,
  NMSG_ERR_CLOSE
} = require('./lib/errors')

const kRequests = Symbol('nanomessage.requests')
const kQueue = Symbol('nanomessage.queue')
const kUnsubscribe = Symbol('nanomessage.unsubscribe')
const kMessageHandler = Symbol('nanomessage.messagehandler')
const kEncode = Symbol('nanomessage.encode')
const kDecode = Symbol('nanomessage.decode')
const kClose = Symbol('nanomessage.close')

class Nanomessage extends NanoresourcePromise {
  /**
   * @constructor
   * @param {NanomessageOptions} [opts]
   */
  constructor (opts = {}) {
    super()

    const { subscribe, send, onMessage, close, timeout = 10 * 1000, concurrency = Infinity, codec = defaultCodec } = opts

    assert(this._send || send, 'send is required')

    if (send) this._send = send
    if (subscribe) this._subscribe = subscribe
    if (onMessage) this.setMessageHandler(onMessage)
    if (close) this[kClose] = close

    this.codec = {
      encode: val => codec.encode(val),
      decode: buf => codec.decode(buf)
    }

    this[kQueue] = new PQueue({
      concurrency,
      timeout,
      throwOnTimeout: true
    })
    this[kRequests] = new Map()
  }

  get requests () {
    return Array.from(this[kRequests].values())
  }

  get isFull () {
    return this[kQueue].pending >= this[kQueue].concurrency
  }

  /**
   * Send a new request and wait for a response.
   *
   * @async
   * @param {*} data - Data to be send it.
   * @returns {CancelablePromise<*>} Returns the remote response.
   */
  request (data) {
    const request = new Request({ data })

    this[kRequests].set(request.id, request)

    request.onFinish(() => {
      this[kRequests].delete(request.id)
      this.emit('request-completed', request.info())
    })

    this[kQueue].add(async () => {
      await this.open()

      const info = request.info()

      await this._send(this[kEncode](info), info)

      return request.promise
    }).catch(err => {
      if (request.finished) return

      if (err.name === 'TimeoutError') {
        return request.reject(new NMSG_ERR_TIMEOUT(request.id))
      }

      request.reject(err)
    })

    this.emit('request-sended', request.info())

    return request.promise
  }

  /**
   * Send a ephemeral message
   *
   * @param {*} data - Data to be send it.
   * @returns {Promise}
   */
  async send (data) {
    await this.open()
    const info = { id: Request.uuid(), data, ephemeral: true }
    return this._send(this[kEncode](info), info)
  }

  /**
   * Defines the request handler.
   *
   * @param {onrequestCallback} onMessage
   */
  setMessageHandler (onMessage) {
    this._onMessage = onMessage
    return this
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

    this[kQueue].clear()
    this[kQueue].pause()

    await (this[kClose] && this[kClose]())
    await Promise.all(requestsToClose)
  }

  [kEncode] ({ id, data, response, ephemeral }) {
    try {
      if (!id) throw new Error('the nmId is required.')
      const chunk = this.codec.encode({
        nmId: id,
        nmData: data,
        nmResponse: response,
        nmEphemeral: ephemeral
      })
      return chunk
    } catch (err) {
      throw new NMSG_ERR_ENCODE(err.message)
    }
  }

  [kDecode] (message) {
    try {
      const request = this.codec.decode(message)
      if (!request.nmId) {
        const err = new NMSG_ERR_INVALID_REQUEST()
        err.request = request
        throw err
      }
      return request
    } catch (err) {
      if (err instanceof NMSG_ERR_INVALID_REQUEST) {
        throw err
      }
      throw new NMSG_ERR_DECODE(err.message)
    }
  }

  async [kMessageHandler] (message) {
    const { nmId, nmData, nmResponse, nmEphemeral } = this[kDecode](message)

    let info = null

    if (nmEphemeral) {
      try {
        info = { id: nmId, data: nmData, ephemeral: nmEphemeral }
        this.emit('request-received', info)
        await this._onMessage(nmData, info)
      } catch (err) {
        this.emit('ephemeral-error', err)
      }
      return
    }

    let request = this[kRequests].get(nmId)

    // Answer
    if (nmResponse) {
      if (request) request.resolve(nmData)
      return
    }

    if (request) {
      // request already beeing process
      return
    }

    request = new Request({ id: nmId, data: nmData, response: true })
    info = request.info()

    request.onFinish(() => {
      this[kRequests].delete(request.id)
    })

    this[kRequests].set(request.id, request)

    this.emit('request-received', info)

    this[kQueue].add(async () => {
      await this.open()
      const data = await this._onMessage(nmData, info)
      await this._send(this[kEncode]({ ...info, data }), { ...info, responseData: data })
      return request.resolve()
    }).catch(err => {
      if (request.finished) return

      if (err.name === 'TimeoutError') {
        return request.reject(new NMSG_ERR_TIMEOUT(request.id))
      }

      request.reject(err)
    })

    try {
      await request.promise
    } catch (err) {
      throw new NMSG_ERR_RESPONSE(nmId, err.message)
    }
  }
}

/**
 * Creates a Nanomessage instance.
 *
 * @default
 * @param {NanomessageOptions} [opts]
 * @returns {Nanomessage}
 */
const nanomessage = (opts) => new Nanomessage(opts)
nanomessage.Nanomessage = Nanomessage
nanomessage.symbols = { kRequests, kQueue, kUnsubscribe, kMessageHandler, kEncode, kDecode, kClose }
nanomessage.errors = require('./lib/errors')
module.exports = nanomessage
