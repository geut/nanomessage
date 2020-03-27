const hyperid = require('hyperid')()

const { NMSG_ERR_CANCEL } = require('./errors')

class Request {
  static uuid () {
    return hyperid()
  }

  constructor (options) {
    const { id = Request.uuid(), task, onFinally } = options

    this.id = id
    this.finished = false

    this._task = task
    this._taskFinished = false

    let _resolve, _reject
    this.promise = new Promise((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })

    this.resolve = (data) => {
      if (!this.finished) {
        this.finished = true
        process.nextTick(() => {
          _resolve(data)
          onFinally({ id, finished: this._taskFinished })
        })
      }
    }

    this.reject = (err) => {
      if (!this.finished) {
        this.finished = true
        process.nextTick(() => {
          _reject(err)
          onFinally({ id, finished: this._taskFinished })
        })
      }
    }

    this.promise.cancel = this.cancel.bind(this)
  }

  start () {
    if (!this.finished) {
      this._task(this.id, (cb) => {
        this._onCancel = cb
      })
        .catch(err => {
          this.reject(err)
        })
        .finally(() => {
          this._taskFinished = true
        })
    }
  }

  cancel (msg) {
    if (msg) {
      msg = `${this.id} ${msg}`
    } else {
      msg = this.id
    }
    const err = new NMSG_ERR_CANCEL(msg)
    this.reject(err)
    this._onCancel && this._onCancel(err, this)
  }
}

module.exports = Request
