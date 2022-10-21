import { NM_ERR_CANCEL, NM_ERR_TIMEOUT } from './errors.js'

const kEmpty = Symbol('empty')
export class RequestInfo {
  constructor (id, response = false, error = false, context = {}, data, getData) {
    this.id = id
    this.response = response
    this.ephemeral = id === 0
    this.error = error
    this.context = context
    this.responseData = undefined
    this._data = getData ? kEmpty : data
    this._getData = getData
  }

  get data () {
    if (this._data !== kEmpty) return this._data
    this._data = this._getData()
    return this._data
  }

  toJSON () {
    return {
      id: this.id,
      data: this.data,
      response: this.response,
      ephemeral: this.ephemeral,
      error: this.error,
      context: this.context,
      responseData: this.responseData
    }
  }
}
export default class Request {
  static info (obj = {}) {
    return new RequestInfo(obj.id, obj.response, obj.error, obj.context, obj.data)
  }

  constructor (opts = {}) {
    const {
      id,
      data,
      response = false,
      timeout,
      signal,
      context = {},
      onCancel = () => new NM_ERR_CANCEL({ id, timeout, context })
    } = opts

    this.id = id
    this.data = data
    this.response = response
    this.finished = false
    this.timeout = timeout
    this.context = context
    this.timer = null

    let _resolve, _reject
    this.promise = new Promise((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })

    const onAbort = () => {
      this.reject(onCancel() || new NM_ERR_CANCEL({ id, timeout }))
    }

    if (signal) {
      if (signal.aborted) {
        queueMicrotask(onAbort)
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
        this.reject(new NM_ERR_TIMEOUT(this.id))
      }, this.timeout)
    }
  }

  onFinish (cb) {
    this._onFinish = cb
  }

  info () {
    return Request.info(this)
  }
}
