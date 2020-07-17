const { NMSG_ERR_CANCEL } = require('./errors')

class Request {
  static info (obj = {}) {
    return {
      id: obj.id,
      data: obj.data,
      response: obj.response || false,
      ephemeral: obj.id === 0
    }
  }

  constructor (info) {
    const { id, data, response = false } = info

    this.id = id
    this.data = data
    this.response = response
    this.finished = false

    let _resolve, _reject
    this.promise = new Promise((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })

    this.resolve = (data) => {
      if (!this.finished) {
        this.finished = true
        this._onFinish && this._onFinish()
        _resolve(data)
      }
    }

    this.reject = (err) => {
      if (!this.finished) {
        this.finished = true
        this._onFinish && this._onFinish(err)
        _reject(err)
      }
    }

    this.promise.cancel = this.cancel.bind(this)
  }

  onFinish (cb) {
    this._onFinish = cb
  }

  cancel (err) {
    if (typeof err === 'string') {
      err = new NMSG_ERR_CANCEL(`${this.id} ${err}`)
    } else if (!err) {
      err = new NMSG_ERR_CANCEL(this.id)
    }

    this.reject(err)
  }

  info () {
    return Request.info(this)
  }
}

module.exports = Request
