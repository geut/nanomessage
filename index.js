const hyperid = require('hyperid')()
const codec = require('buffer-json-encoding')

const { TimeoutError, NotRequestError, ResponseError, CloseError } = require('./errors')

const encode = (id, data, initiator) => ({ _arId: id, _arData: data, _arInitiator: initiator })

class Request {
  constructor (data, timeout) {
    this.id = hyperid()
    this.requestEncoded = encode(this.id, data, true)
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
      this.timer = setTimeout(() => {
        reject(new TimeoutError(this.requestEncoded))
      }, timeout)
    })
  }

  clear () {
    clearTimeout(this.timer)
  }

  resolve (data) {
    this.clear()
    this._resolve(data)
  }
}

class AbstractRequest {
  static isRequest (request = {}) {
    return request._arId
  }

  constructor (middleware, options = {}) {
    console.assert(middleware)
    console.assert(middleware.send)
    console.assert(middleware.subscribe)

    const { send, onmessage, subscribe } = middleware
    const { timeout = 10 * 1000 } = options

    this._send = async (...args) => send(...args)
    this._subscribe = (...args) => subscribe(...args)
    this._timeout = timeout
    this._requests = new Map()
    this.setMessageHandler(onmessage)

    this._init()
  }

  close () {
    this._subscription()

    this._requests.forEach(request => {
      request.clear()
      request._reject(new CloseError(request.id))
    })

    this._requests.clear()
  }

  async request (data) {
    const request = new Request(data, this._timeout)
    this._requests.set(request.id, request)

    try {
      await this._send(request.requestEncoded)
      const data = await request.promise
      request.clear()
      this._requests.delete(request.id)
      return data
    } catch (err) {
      request.clear()
      this._requests.delete(request.id)
      throw err
    }
  }

  setMessageHandler (onmessage = () => {}) {
    this._onmessage = async (...args) => onmessage(...args)
  }

  _init () {
    this._subscription = this._subscribe(async request => {
      if (!AbstractRequest.isRequest(request)) throw new NotRequestError(request)

      const { _arId, _arData, _arInitiator } = request

      try {
        if (_arInitiator) {
          const data = await this._onmessage(_arData)
          await this._send(encode(_arId, data, false))
        }
      } catch (err) {
        throw new ResponseError(_arId, err)
      }

      request = this._requests.get(_arId)
      if (request) {
        request.resolve(_arData)
      }
    }) || (() => {})
  }
}

function createFromSocket (socket, options = {}) {
  const onmessage = options.onmessage
  delete options.onmessage

  const ar = new AbstractRequest({
    subscribe (ondata) {
      socket.on('data', async (data) => {
        try {
          await ondata(codec.decode(data))
        } catch (err) {
          console.log(err)
        }
      })
    },
    send (request) {
      socket.write(codec.encode(request))
    },
    onmessage
  }, options)

  socket.on('close', () => {
    ar.close()
  })

  ar.socket = socket

  return ar
}

module.exports = (...args) => new AbstractRequest(...args)
module.exports.AbstractRequest = AbstractRequest
module.exports.createFromSocket = createFromSocket
