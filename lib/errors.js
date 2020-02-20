const nanoerror = require('nanoerror')

const errors = {}

function createError (code, message) {
  errors[code] = nanoerror(code, message)
}

createError('NMSG_ERR_TIMEOUT', 'timeout on request: %s')
createError('NMSG_ERR_ENCODE', 'error encoding the request: %s')
createError('NMSG_ERR_DECODE', 'error decoding the request: %s')
createError('NMSG_ERR_RESPONSE', 'response error on request: %s')
createError('NMSG_ERR_CLOSE', 'nanomessage was closed')
createError('NMSG_ERR_INVALID_REQUEST', 'invalid request, missing nmId')
createError('NMSG_ERR_CANCEL', 'request canceled: %s')

module.exports = errors
