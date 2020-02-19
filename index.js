/**
 * @typedef {object} NanomessageOptions
 * @property {send} [opts.send]
 * @property {subscribe} [opts.subscribe]
 * @property {onrequest} [opts.onrequest]
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
 * @callback onrequest
 * @param {!Buffer} data
 * @returns {Promise<*>} - Response with any data.
 */

/**
 * Runs and wait for a close operation.
 * @callback close
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
    const { subscribe, send, onrequest, close, timeout = 10 * 1000, codec = defaultCodec } = opts

    if (subscribe) this._subscribe = (...args) => subscribe(...args)
    if (send) this._send = async (...args) => send(...args)
    if (onrequest) this.setRequestHandler(onrequest)
    if (close) this._close = async (...args) => close(...args)

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
      request.reject(new NMSG_ERR_CLOSE())
    })

    this[kRequests].clear()
    await this._close()
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
      task: (id, data) => this._send(this[kEncode](id, data)),
      onfinally: () => {
        request.checkPendingTask()
        this[kRequests].delete(request.id)
      }
    })
    this[kRequests].set(request.id, request)

    return request
  }

  /**
   * Defines the request handler.
   *
   * @param {onrequestCallback} onrequest
   */
  setRequestHandler (onrequest) {
    this._onrequest = (data) => onrequest(data)
    return this
  }

  _onrequest () {}

  [kInit] () {
    this[kSubscription] = this._subscribe(async message => {
      const { nmId, nmData, nmResponse } = this[kDecode](message)

      // Answer
      if (nmResponse) {
        const request = this[kRequests].get(nmId)
        if (request) request.resolve(nmData)
        return
      }

      const request = new Request({
        id: nmId,
        data: nmData,
        response: true,
        timeout: this[kTimeout],
        task: async (id, data) => {
          data = await this._onrequest(data)
          await this._send(this[kEncode](id, data, true))
          request.resolve()
        },
        onfinally: () => {
          request.checkPendingTask()
          this[kRequests].delete(request.id)
        }
      })
      this[kRequests].set(request.id, request)

      try {
        await request
      } catch (err) {
        throw new NMSG_ERR_RESPONSE(nmId, err.message)
      }
    }) || (() => {})
  }

  [kEncode] (id, data, response) {
    try {
      if (!id) throw new Error('The nmId is required.')
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
