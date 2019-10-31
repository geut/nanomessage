/**
 * @typedef {object} NanomessageOptions
 * @property {sendCallback} [opts.send]
 * @property {subscribeCallback} [opts.subscribe]
 * @property {onrequestCallback} [opts.onrequest]
 * @property {function} [opts.close]
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
 * How to send the data.
 * @callback sendCallback
 * @param {Buffer}
 * @returns {Promise}
 */

/**
 * Subscribe for the incoming data.
 * @callback subscribeCallback
 * @param {!function} onData
 * @returns {?function} - Unsubscribe function.
 */

/**
 * Request handler.
 * @callback onrequestCallback
 * @param {!Buffer} data
 * @returns {Promise<*>} - Response with any data.
 */

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
const kInit = Symbol('nanomessage.init')
const kSubscription = Symbol('nanomessage.subscription')
const kCodec = Symbol('nanomessage.codec')
const kEncode = Symbol('nanomessage.encode')
const kDecode = Symbol('nanomessage.decode')

class Nanomessage {
  /**
   * @constructor
   * @param {NanomessageOptions} [opts]
   */
  constructor (opts = {}) {
    const { send, subscribe, onrequest, close, timeout = 10 * 1000, codec = defaultCodec } = opts

    if (send) this._send = send
    if (subscribe) this._subscribe = subscribe
    if (onrequest) this.setRequestHandler(onrequest)
    if (close) this._close = close

    this[kTimeout] = timeout
    this[kRequests] = new Map()
    this[kCodec] = codec

    this[kInit]()
  }

  /**
   * Close the nanomessage, unsubscribe from new incoming data.
   *
   * @returns {Promise}
   */
  async close () {
    this[kSubscription]()

    this[kRequests].forEach(request => {
      request.clear()
      request._reject(new NMSG_ERR_CLOSE(request.id))
    })

    this[kRequests].clear()
    await this._close()
  }

  /**
   * Send a new request and wait for a response.
   *
   * @param {*} data - Data to be send it.
   * @returns {Promise<*>} Returns the remote response.
   */
  async request (data) {
    const request = new Request(data, this[kTimeout])
    this[kRequests].set(request.id, request)

    try {
      await this._send(this[kEncode](request.id, request.data, 0))
      const data = await request.promise
      request.clear()
      this[kRequests].delete(request.id)
      return data
    } catch (err) {
      request.clear()
      this[kRequests].delete(request.id)
      throw err
    }
  }

  /**
   * Defines the request handler.
   *
   * @param {onrequestCallback} cb
   */
  setRequestHandler (cb) {
    this._onrequest = cb
  }

  _onrequest () {}

  [kInit] () {
    this[kSubscription] = this._subscribe(async message => {
      const { nmId, nmData, nmAck } = this[kDecode](message)

      if (nmAck) {
        const request = this[kRequests].get(nmId)
        if (request) request.resolve(nmData)
        return
      }

      try {
        const data = await this._onrequest(nmData)
        await this._send(this[kEncode](nmId, data, 1))
      } catch (err) {
        throw new NMSG_ERR_RESPONSE(nmId, err.message)
      }
    }) || (() => {})
  }

  [kEncode] (id, data, ack) {
    try {
      if (!id) throw new Error('The nmId is required.')
      const chunk = this[kCodec].encode({ nmId: id, nmData: data, nmAck: ack })
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
}

/**
 * Create a nanomessage from a socket.
 *
 * @param {object} socket
 * @param {NanomessageOptions} [opts]
 * @returns {Nanomessage}
 */
function createFromSocket (socket, options = {}) {
  const nm = new Nanomessage(Object.assign({
    subscribe (ondata) {
      socket.on('data', async (data) => {
        try {
          await ondata(data)
        } catch (err) {
          socket.emit('error', err)
        }
      })
    },
    send (chunk) {
      socket.write(chunk)
    },
    close () {
      if (socket.destroyed) return
      return new Promise(resolve => socket.destroy(null, resolve))
    }
  }, options))

  socket.on('close', () => {
    nm.close()
  })

  nm.socket = socket

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
nanomessage.createFromSocket = createFromSocket
nanomessage.symbols = { kRequests, kTimeout, kInit, kSubscription, kCodec, kEncode, kDecode }
module.exports = nanomessage
