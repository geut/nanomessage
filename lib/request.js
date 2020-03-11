const hyperid = require('hyperid')()

const { NMSG_ERR_CANCEL } = require('./errors')

class Request {
  static uuid () {
    return hyperid()
  }

  constructor (options) {
    const { id = Request.uuid(), task, onFinally } = options

    let _resolve, _reject
    this._promise = new Promise((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })

    this.resolve = (data) => {
      process.nextTick(() => {
        this._finished = true
        _resolve(data)
        onFinally({ id, finished: this._taskFinished })
      })
    }

    this.reject = (err) => {
      process.nextTick(() => {
        this._finished = true
        _reject(err)
        onFinally({ id, finished: this._taskFinished })
      })
    }

    this._promise.cancel = () => {
      this.reject(new NMSG_ERR_CANCEL(this.id))
    }

    this._id = id
    this._task = task
    this._finished = false
    this._taskFinished = false
  }

  get id () {
    return this._id
  }

  get promise () {
    return this._promise
  }

  start () {
    if (!this._finished) {
      this._task(this._id)
        .catch(err => {
          this.reject(err)
        })
        .finally(() => {
          this._taskFinished = true
        })
    }
  }
}

module.exports = Request
