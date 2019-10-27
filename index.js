const Request = require('./lib/request')
const defaultCodec = require('./lib/codec')
const { EncodeError, DecodeError, ResponseError, CloseError } = require('./lib/errors')

const _requests = Symbol('requests')
const _timeout = Symbol('timeout')
const _init = Symbol('init')
const _subscription = Symbol('subscription')
const _codec = Symbol('codec')
const _encode = Symbol('encode')
const _decode = Symbol('decode')

class Nanomessage {
  static isRequest (request) {
    return typeof request === 'object' && request._nmId
  }

  constructor (opts = {}) {
    const { send, subscribe, onmessage, timeout = 10 * 1000, codec = defaultCodec } = opts

    if (send) this._send = send
    if (subscribe) this._subscribe = subscribe
    this.setMessageHandler(onmessage)

    this[_timeout] = timeout
    this[_requests] = new Map()
    this[_codec] = codec

    this[_init]()
  }

  close () {
    this[_subscription]()

    this[_requests].forEach(request => {
      request.clear()
      request._reject(new CloseError(null, { id: request.id }))
    })

    this[_requests].clear()
  }

  async request (data) {
    const request = new Request(data, this[_timeout])
    this[_requests].set(request.id, request)

    try {
      await this._send(this[_encode](request.id, request.data, 0))
      const data = await request.promise
      request.clear()
      this[_requests].delete(request.id)
      return data
    } catch (err) {
      request.clear()
      this[_requests].delete(request.id)
      throw err
    }
  }

  setMessageHandler (cb = () => {}) {
    this._onmessage = cb
  }

  [_init] () {
    this[_subscription] = this._subscribe(async message => {
      const { nmId, nmData, nmAck } = this[_decode](message)

      if (nmAck) {
        const request = this[_requests].get(nmId)
        if (request) request.resolve(nmData)
        return
      }

      try {
        const data = await this._onmessage(nmData)
        await this._send(this[_encode](nmId, data, 1))
      } catch (err) {
        throw new ResponseError(nmId, err)
      }
    }) || (() => {})
  }

  [_encode] (id, data, ack) {
    try {
      if (!id) throw new Error('The nmId is required.')
      const chunk = this[_codec].encode({ nmId: id, nmData: data, nmAck: ack })
      return chunk
    } catch (err) {
      throw new EncodeError(err.message, { id, data, ack })
    }
  }

  [_decode] (message) {
    try {
      const request = this[_codec].decode(message)
      if (!request.nmId) throw new Error('The nmId is required.')
      return request
    } catch (err) {
      throw new DecodeError(err.message, { message })
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
          console.log(err)
        }
      })
    },
    send (chunk) {
      socket.write(chunk)
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
module.exports.symbols = { _requests, _timeout, _init, _subscription, _codec, _encode, _decode }
