const format = require('quick-format-unescaped')

const errors = {}

function createError (code, message) {
  errors[code] = class extends Error {
    constructor (...args) {
      super(format(message, args))

      this.name = code

      if (typeof Error.captureStackTrace === 'function') {
        Error.captureStackTrace(this, this.constructor)
      } else {
        this.stack = (new Error(this.message)).stack
      }

      this.code = code
      this.args = args
    }
  }
}

createError('NMSG_ERR_TIMEOUT', 'Timeout on request: %s.')
createError('NMSG_ERR_ENCODE', 'Error encoding the request: %s')
createError('NMSG_ERR_DECODE', 'Error decoding the request: %s')
createError('NMSG_ERR_RESPONSE', 'Response error on request: %s.')
createError('NMSG_ERR_CLOSE', 'Nanomessage close during the request: %s.')
createError('NMSG_ERR_INVALID_REQUEST', 'Invalid request, missing nmId.')

module.exports = errors
