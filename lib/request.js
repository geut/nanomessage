const hyperid = require('hyperid')()

const { NMSG_ERR_TIMEOUT, NMSG_ERR_CANCEL } = require('./errors')

const kResolve = Symbol('resolve')
const kReject = Symbol('reject')
const kId = Symbol('id')
const kTimer = Symbol('timer')
const kTask = Symbol('task')
const kOnFinally = Symbol('onfinally')
const kClear = Symbol('clear')

class Request extends Promise {
  constructor (options) {
    if (options instanceof Function) {
      return new Promise(options)
    }

    const { id = hyperid(), data, response = false, timeout, task, onFinally } = options

    let _resolve, _reject
    super((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })
    this[kResolve] = (data) => {
      this[kClear]()
      process.nextTick(() => {
        _resolve(data)
        this[kOnFinally]({ id, response, task: this[kTask] })
      })
    }
    this[kReject] = (err) => {
      this[kClear]()
      process.nextTick(() => {
        _reject(err)
        this[kOnFinally]({ id, response, task: this[kTask] })
      })
    }

    this[kId] = id

    this[kTask] = task(id, data, response)
      .catch(err => {
        this[kReject](err)
      })
      .finally(() => {
        this[kTask] = null
      })

    this[kOnFinally] = r => onFinally(r)

    this[kTimer] = setTimeout(() => {
      this[kReject](new NMSG_ERR_TIMEOUT(this.id, this.data, timeout))
    }, timeout)
  }

  get id () {
    return this[kId]
  }

  cancel () {
    this[kReject](new NMSG_ERR_CANCEL(this.id))
  }

  [kClear] () {
    clearTimeout(this[kTimer])
  }
}

module.exports = Request
module.exports.symbols = { kResolve, kReject }
