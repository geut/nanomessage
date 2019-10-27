const CustomError = require('custom-error-class')

function createError (className, message, code) {
  exports[className] = class extends CustomError {
    constructor (reason, data = {}) {
      super(message)
      this.code = code
      this.reason = reason
      this.data = data
    }
  }
}

createError('TimeoutError', 'Timeout on request.', 'ERR_TIMEOUT')
createError('EncodeError', 'Error encoding the request.', 'ERR_ENCODE')
createError('DecodeError', 'Error decoding the request.', 'ERR_DECODE')
createError('ResponseError', 'Response error on request.', 'ERR_RESPONSE')
createError('CloseError', 'Nanomessage close.', 'ERR_CLOSE')
