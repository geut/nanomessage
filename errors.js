const CustomError = require('custom-error-class')

exports.TimeoutError = class TimeoutError extends CustomError {
  constructor (request) {
    super('Timeout on request.')
    this.code = 'ERR_REQUEST_TIMEOUT'
    this.request = request
  }
}

exports.NotRequestError = class NotRequestError extends CustomError {
  constructor (request) {
    super('It is not a request.')
    this.code = 'ERR_NOT_REQUEST'
    this.request = request
  }
}

exports.ResponseError = class ResponseError extends CustomError {
  constructor (id, reason) {
    super('Response error on request.')
    this.code = 'ERR_RESPONSE'
    this.reason = reason
    this.request = { _arId: id }
  }
}

exports.CloseError = class CloseError extends CustomError {
  constructor (id, reason) {
    super('AbstractRequest close.')
    this.code = 'ERR_CLOSE'
    this.reason = reason
    this.request = { _arId: id }
  }
}
