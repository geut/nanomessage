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
 * @returns {Promise}
 */

/**
 * Request handler.
 * @callback onMessage
 * @param {!Buffer} data
 * @returns {Promise<*>} - Response with any data.
 */

/**
 * Runs and wait for a close operation.
 * @callback close
 * @returns {Promise<*>} - Response with any data.
 */

const { EventEmitter } = require('events')
const assert = require('nanocustomassert')
const eos = require('end-of-stream')
const nanoresource = require('nanoresource-promise')
const { default: PQueue } = require('p-queue')

const Request = require('./lib/request')
const defaultCodec = require('./lib/codec')
const {
  NMSG_ERR_ENCODE,
  NMSG_ERR_DECODE,
  NMSG_ERR_RESPONSE,
  NMSG_ERR_CLOSE,
  NMSG_ERR_INVALID_REQUEST,
  NMSG_ERR_TIMEOUT
} = require('./lib/errors')

const kRequests = Symbol('nanomessage.requests')
const kQueue = Symbol('nanomessage.queue')
const kUnsubscribe = Symbol('nanomessage.unsubscribe')
const kMessageHandler = Symbol('nanomessage.messagehandler')
const kCodec = Symbol('nanomessage.codec')
const kEncode = Symbol('nanomessage.encode')
const kDecode = Symbol('nanomessage.decode')
const kEndRequest = Symbol('nanomessage.endrequest')
const kNanoresource = Symbol('nanomessage.nanoresource')
const kOpen = Symbol('nanomessage.open')
const kClose = Symbol('nanomessage.close')

class Nanomessage extends EventEmitter {
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
    if (close) this._close = close

    this[kQueue] = new PQueue({
      concurrency,
      timeout,
      throwOnTimeout: true
    })

    this[kRequests] = new Map()
    this[kCodec] = codec
    this[kNanoresource] = nanoresource({
      open: this[kOpen].bind(this),
      close: this[kClose].bind(this)
    })
  }

  get codec () {
    return this[kCodec]
  }

  /**
   * Send a new request and wait for a response.
   *
   * @async
   * @param {*} data - Data to be send it.
   * @returns {CancelablePromise<*>} Returns the remote response.
   */
  request (data) {
    const request = new Request({
      task: async (id) => {
        await this.open()
        await this._send(this[kEncode]({ id, data }))
      },
      onFinally: (req) => {
        this[kEndRequest](req)
      }
    })

    this[kRequests].set(request.id, request)
    this[kQueue].add(() => {
      request.start()
      return request.promise
    }).catch(err => {
      if (err.name === 'TimeoutError') {
        request.reject(new NMSG_ERR_TIMEOUT(request.id))
      }
    })

    this.emit('request-sended', request)

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
    await this._send(this[kEncode]({ id: Request.uuid(), data, ephemeral: true }))
  }

  /**
   * Opens nanomessage
   *
   * @returns {Promise}
   */
  open () {
    return this[kNanoresource].open()
  }

  /**
   * Closes nanomessage
   * @returns {Promise}
   */
  close () {
    return this[kNanoresource].close()
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

  async _close () {}

  async [kOpen] () {
    assert(this._subscribe, 'subscribe is required')

    this[kUnsubscribe] = this._subscribe(this[kMessageHandler].bind(this))
  }

  async [kClose] () {
    if (this[kUnsubscribe]) this[kUnsubscribe]()

    this[kRequests].forEach(request => {
      request.reject(new NMSG_ERR_CLOSE())
    })

    this[kRequests].clear()
    await this._close()
    this.emit('closed')
  }

  [kEncode] ({ id, data, response, ephemeral }) {
    try {
      if (!id) throw new Error('the nmId is required.')
      const chunk = this[kCodec].encode({ nmId: id, nmData: data, nmResponse: response, nmEphemeral: ephemeral })
      return chunk
    } catch (err) {
      throw new NMSG_ERR_ENCODE(err.message)
    }
  }

  [kDecode] (message) {
    try {
      const request = this[kCodec].decode(message)
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

  [kEndRequest] (request) {
    this[kRequests].delete(request.id)
    if (!request.finished) this.emit('task-pending', request.id)
    this.emit('request-ended', request.id)
  }

  async [kMessageHandler] (message) {
    const { nmId, nmData, nmResponse, nmEphemeral } = this[kDecode](message)

    if (nmEphemeral) {
      try {
        await this._onMessage(nmData, nmEphemeral)
      } catch (err) {
        console.error(err)
      }
      return
    }

    // Answer
    if (nmResponse) {
      const request = this[kRequests].get(nmId)
      if (request) request.resolve(nmData)
      return
    }

    const request = new Request({
      id: nmId,
      task: async (id) => {
        this.emit('request-received', nmData)
        const data = await this._onMessage(nmData)
        await this._send(this[kEncode]({ id, data, response: true }))
        request.resolve()
      },
      onFinally: (req) => {
        this[kEndRequest](req)
      }
    })

    this[kRequests].set(request.id, request)

    this[kQueue].add(() => {
      request.start()
      return request.promise
    }).catch(err => {
      if (err.name === 'TimeoutError') {
        request.reject(new NMSG_ERR_TIMEOUT(request.id))
      }
    })

    try {
      await request.promise
    } catch (err) {
      throw new NMSG_ERR_RESPONSE(nmId, err.message)
    }
  }
}

/**
 * Create a nanomessage from a socket.
 *
 * @param {DuplexStream} stream
 * @param {NanomessageOptions} [opts]
 * @returns {Nanomessage}
 */
function createFromStream (stream, options = {}) {
  const nm = new Nanomessage(Object.assign({
    subscribe (ondata) {
      stream.on('data', async (data) => {
        try {
          await ondata(data)
        } catch (err) {
          process.nextTick(() => stream.emit('error', err))
        }
      })
    },
    send (chunk) {
      if (stream.destroyed) return
      stream.write(chunk)
    },
    close () {
      if (stream.destroyed) return
      return new Promise(resolve => {
        eos(stream, () => resolve())
        stream.destroy()
      })
    }
  }, options))

  nm.open().catch(err => {
    process.nextTick(() => stream.emit('error', err))
  })

  stream.on('close', () => {
    nm.close()
  })

  nm.stream = stream

  return nm
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
nanomessage.createFromStream = createFromStream
nanomessage.symbols = { kRequests, kQueue, kUnsubscribe, kMessageHandler, kCodec, kEncode, kDecode, kOpen, kClose }
nanomessage.errors = require('./lib/errors')
module.exports = nanomessage
