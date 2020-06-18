const hyperid = require('hyperid')()

const { NMSG_ERR_CANCEL } = require('./errors')
const assert = require('nanocustomassert')

class Request {
  static uuid () {
    return hyperid()
  }

  static info (obj = {}) {
    assert(obj.id, 'id is required')

    const { id, data, ephemeral = false, response = false } = obj

    return {
      id,
      data,
      ephemeral,
      response
    }
  }

  constructor (info) {
    const { id = Request.uuid(), data, ephemeral = false, response = false } = info

    this.id = id
    this.data = data
    this.ephemeral = ephemeral
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
    return Request.info(this)
  }
}

module.exports = Request
