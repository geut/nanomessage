import { NMSG_ERR_CANCEL, NMSG_ERR_TIMEOUT } from './errors.js'

export default class Request {
  static info (obj = {}) {
    return {
      id: obj.id,
      data: obj.data,
      response: obj.response || false,
      ephemeral: obj.id === 0,
      args: obj.args
    }
  }

  constructor (opts = {}) {
    const { id, data, response = false, timeout, signal, args } = opts

    this.id = id
    this.data = data
    this.response = response
    this.finished = false
    this.timeout = timeout
    this.args = args
    this.timer = null

    let _resolve, _reject
    this.promise = new Promise((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })

    this.promise.cancel = this.cancel.bind(this)

    const onAbort = () => this.cancel()
    if (signal) {
      if (signal.aborted) {
        process.nextTick(onAbort)
      } else {
        signal.addEventListener('abort', onAbort)
      }
    }

    this.resolve = (data) => {
      if (!this.finished) {
        this.timer && clearTimeout(this.timer)
        signal && signal.removeEventListener('abort', onAbort)
        this.finished = true
        this._onFinish()
        _resolve(data)
      }
    }

    this.reject = (err) => {
      if (!this.finished) {
        this.timer && clearTimeout(this.timer)
        signal && signal.removeEventListener('abort', onAbort)
        this.finished = true
        this._onFinish(err)
        _reject(err)
      }
    }
  }

  start () {
    if (this.timeout) {
      this.timer = setTimeout(() => {
        this.reject(new NMSG_ERR_TIMEOUT(this.id))
      }, this.timeout)
    }
  }

  onFinish (cb) {
    this._onFinish = cb
  }

  cancel (err) {
    if (!err) {
      err = new NMSG_ERR_CANCEL(this.id)
    } else if (typeof err === 'string') {
      err = new NMSG_ERR_CANCEL(this.id, err)
    }

    this.reject(err)
  }

  info () {
    return Request.info(this)
  }
}
