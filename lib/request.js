const hyperid = require('hyperid')()

const { NMSG_ERR_CANCEL } = require('./errors')
const assert = require('nanocustomassert')

class Request {
  static uuid () {
    return hyperid()
  }

  static info (obj = {}) {
    assert(obj.id, 'id is required')

    return {
      id: obj.id,
      data: obj.data,
      ephemeral: obj.ephemeral || false,
      response: obj.response || false
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
      }
    }

    this.reject = (err) => {
      if (!this.finished) {
        this.finished = true
        _reject(err)
      }
    }

    this.promise.cancel = this.cancel.bind(this)
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
