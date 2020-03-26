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
      process.nextTick(() => {
        this.finished = true
        _resolve(data)
        onFinally({ id, finished: this._taskFinished })
      })
    }

    this.reject = (err) => {
      process.nextTick(() => {
        this.finished = true
        _reject(err)
        onFinally({ id, finished: this._taskFinished })
      })
    }

    this.promise.cancel = () => {
      this.reject(new NMSG_ERR_CANCEL(this.id))
    }
  }

  start () {
    if (!this.finished) {
      this._task(this.id)
        .catch(err => {
          this.reject(err)
        })
        .finally(() => {
          this._taskFinished = true
        })
    }
  }

  cancel () {
    this.reject(new NMSG_ERR_CANCEL(this.id))
  }
}

module.exports = Request
