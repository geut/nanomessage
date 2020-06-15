const hyperid = require('hyperid')()

const { NMSG_ERR_CANCEL } = require('./errors')

class Request {
  static uuid () {
    return hyperid()
  }

  constructor (info) {
    const { id = Request.uuid(), data, response = false, ephemeral = false } = info

    this.id = id
    this.data = data
    this.response = response
    this.ephemeral = ephemeral
    this.finished = false

    let _resolve, _reject
    this.promise = new Promise((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })

    this.resolve = (data) => {
      if (!this.finished) {
        this.finished = true
        _resolve(data)
        this._finish()
      }
    }

    this.reject = (err) => {
      if (!this.finished) {
        this.finished = true
        _reject(err)
        this._finish()
      }
    }

    this.promise.cancel = this.cancel.bind(this)
  }

  onFinish (cb) {
    this._finish = cb
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
    return {
      id: this.id,
      data: this.data,
      response: this.response,
      ephemeral: this.ephemeral
    }
  }
}

module.exports = Request
