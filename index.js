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
  static isRequest (request) {
    return typeof request === 'object' && request._nmId
  }

  constructor (opts = {}) {
    const { send, subscribe, close, onrequest, timeout = 10 * 1000, codec = defaultCodec } = opts

    if (send) this._send = send
    if (subscribe) this._subscribe = subscribe
    if (close) this._close = close
    if (onrequest) this.setRequestHandler(onrequest)

    this[kTimeout] = timeout
    this[kRequests] = new Map()
    this[kCodec] = codec

    this[kInit]()
  }

  async close () {
    this[kSubscription]()

    this[kRequests].forEach(request => {
      request.clear()
      request._reject(new NMSG_ERR_CLOSE(request.id))
    })

    this[kRequests].clear()
    await this._close()
  }

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
      if (err.code === 'NMSG_ERR_INVALID_REQUEST') {
        throw err
      }
      throw new NMSG_ERR_DECODE(err.message)
    }
  }
}

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

module.exports = (...args) => new Nanomessage(...args)
module.exports.Nanomessage = Nanomessage
module.exports.createFromSocket = createFromSocket
module.exports.symbols = { kRequests, kTimeout, kInit, kSubscription, kCodec, kEncode, kDecode }
