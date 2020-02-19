const nanoerror = require('nanoerror')

const errors = {}

function createError (code, message) {
  errors[code] = nanoerror(code, message)
}

createError('NMSG_ERR_TIMEOUT', 'Timeout on request: %s')
createError('NMSG_ERR_ENCODE', 'Error encoding the request: %s')
createError('NMSG_ERR_DECODE', 'Error decoding the request: %s')
createError('NMSG_ERR_RESPONSE', 'Response error on request: %s')
createError('NMSG_ERR_CLOSE', 'Nanomessage was closed')
createError('NMSG_ERR_INVALID_REQUEST', 'Invalid request, missing nmId')
createError('NMSG_ERR_CANCEL', 'Request canceled: %s')

module.exports = errors
