/**
 * @typedef {object} NanomessageOptions
 * @property {send} [opts.send]
 * @property {subscribe} [opts.subscribe]
 * @property {onRequest} [opts.onRequest]
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
 * @callback onRequest
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

const Request = require('./lib/request')
const defaultCodec = require('./lib/codec')
const {
  NMSG_ERR_ENCODE,
  NMSG_ERR_DECODE,
  NMSG_ERR_RESPONSE,
  NMSG_ERR_CLOSE,
  NMSG_ERR_INVALID_REQUEST
} = require('./lib/errors')

const kRequests = Symbol('nanomessage.requests')
const kTimeout = Symbol('nanomessage.timeout')
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

    const { subscribe, send, onRequest, close, timeout = 10 * 1000, codec = defaultCodec } = opts

    assert(this._send || send, 'send is required')

    if (send) this._send = send
    if (subscribe) this._subscribe = subscribe
    if (onRequest) this.setRequestHandler(onRequest)
    if (close) this._close = close

    this[kTimeout] = timeout
    this[kRequests] = new Map()
    this[kCodec] = codec
    this[kNanoresource] = nanoresource({
      open: this[kOpen].bind(this),
      close: this[kClose].bind(this)
    })
  }

  /**
   * Send a new request and wait for a response.
   *
   * @param {*} data - Data to be send it.
   * @returns {Request<*>} Returns the remote response.
   */
  request (data) {
    const request = new Request({
      data,
      timeout: this[kTimeout],
      task: async (id, data) => {
        await this.open()
        await this._send(this[kEncode](id, data))
      },
      onFinally: (req) => {
        this[kEndRequest](req)
      }
    })
    this[kRequests].set(request.id, request)
    this.emit('request-sended', request)

    return request
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
   * @param {onrequestCallback} onRequest
   */
  setRequestHandler (onRequest) {
    this._onRequest = onRequest
    return this
  }

  async _onRequest () {
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
      request[Request.symbols.kReject](new NMSG_ERR_CLOSE())
    })

    this[kRequests].clear()
    await this._close()
    this.emit('closed')
  }

  [kEncode] (id, data, response) {
    try {
      if (!id) throw new Error('the nmId is required.')
      const chunk = this[kCodec].encode({ nmId: id, nmData: data, nmResponse: response })
      return chunk
    } catch (err) {
      throw new NMSG_ERR_ENCODE(err.message)
    }
  }

  [kDecode] (message) {
    try {
      const request = this[kCodec].decode(message)
      if (!request.nmId) throw new NMSG_ERR_INVALID_REQUEST()
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
    if (request.task) this.emit('task-pending', request)
    this.emit('request-ended', request.id)
  }

  async [kMessageHandler] (message) {
    const { nmId, nmData, nmResponse } = this[kDecode](message)

    // Answer
    if (nmResponse) {
      const request = this[kRequests].get(nmId)
      if (request) request[Request.symbols.kResolve](nmData)
      return
    }

    const request = new Request({
      id: nmId,
      data: nmData,
      response: true,
      timeout: this[kTimeout],
      task: async (id, data, response) => {
        this.emit('request-received', data)
        data = await this._onRequest(data)
        await this._send(this[kEncode](id, data, response))
        request[Request.symbols.kResolve]()
      },
      onFinally: (req) => {
        this[kEndRequest](req)
      }
    })
    this[kRequests].set(request.id, request)

    try {
      await request
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
nanomessage.symbols = { kRequests, kTimeout, kUnsubscribe, kMessageHandler, kCodec, kEncode, kDecode, kOpen, kClose }
nanomessage.errors = require('./lib/errors')
module.exports = nanomessage
