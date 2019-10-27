const hyperid = require('hyperid')()

const { TimeoutError } = require('./errors')

class Request {
  constructor (data, timeout) {
    this.id = hyperid()
    this.data = data
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
      this.timer = setTimeout(() => {
        reject(new TimeoutError(null, { timeout, id: this.id, data: this.data }))
      }, timeout)
    })
  }

  clear () {
    clearTimeout(this.timer)
  }

  resolve (data) {
    this.clear()
    this._resolve(data)
  }
}

module.exports = Request
