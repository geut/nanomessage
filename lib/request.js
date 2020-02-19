const hyperid = require('hyperid')()

const { NMSG_ERR_TIMEOUT, NMSG_ERR_CANCEL } = require('./errors')

class Request extends Promise {
  constructor (options) {
    if (options instanceof Function) {
      return new Promise(options)
    }

    const { id = hyperid(), data, response = false, timeout, task, onfinally } = options

    let _resolve, _reject
    super((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })
    this._resolve = _resolve
    this._reject = _reject

    this.id = id
    this.data = data
    this.response = response

    this._taskIsPending = true
    this._task = task(id, data)
      .catch(err => {
        this.reject(err)
      })
      .finally(() => {
        this._taskIsPending = false
      })

    this._onfinally = err => onfinally(err)

    this._timer = setTimeout(() => {
      this.reject(new NMSG_ERR_TIMEOUT(this.id, this.data, timeout))
    }, timeout)
  }

  clear () {
    clearTimeout(this.timer)
  }

  resolve (data) {
    this.clear()
    process.nextTick(() => {
      this._resolve(data)
      this._onfinally()
    })
  }

  reject (err) {
    this.clear()
    process.nextTick(() => {
      this._reject(err)
      this._onfinally()
    })
  }

  cancel () {
    this.reject(new NMSG_ERR_CANCEL(this.id))
  }

  checkPendingTask () {
    if (this._taskIsPending) {
      console.warn(`Request ${this.response ? '[response]' : '[origin]'} ends with a pending task: ${this.id}`)
    }
  }
}

module.exports = Request
