import nanoerror from 'nanoerror'

const errors = new Map()

export function createError (code, message, persist = false) {
  const err = nanoerror(code, message)
  if (persist) errors.set(code, err)
  return err
}

export function encodeError (err) {
  return {
    code: err.code,
    unformatMessage: err.unformatMessage,
    args: err.args,
    metadata: err.metadata
  }
}

export function decodeError ({ code, unformatMessage, args = [], metadata = {} }) {
  const ErrorDecoded = errors.get(code) || nanoerror(code, unformatMessage)
  const err = new ErrorDecoded(...args)
  err.metadata = metadata
  return err
}

export const NM_ERR_TIMEOUT = createError('NM_ERR_TIMEOUT', 'timeout on request: %s', true)
export const NM_ERR_ENCODE = createError('NM_ERR_ENCODE', 'error encoding the request: %s', true)
export const NM_ERR_DECODE = createError('NM_ERR_DECODE', 'error decoding the request: %s', true)
export const NM_ERR_MESSAGE = createError('NM_ERR_MESSAGE', 'on message error: %s', true)
export const NM_ERR_REMOTE_RESPONSE = createError('NM_ERR_REMOTE_RESPONSE', 'remote response error: %s', true)
export const NM_ERR_CLOSE = createError('NM_ERR_CLOSE', 'nanomessage was closed', true)
export const NM_ERR_NOT_OPEN = createError('NM_ERR_NOT_OPEN', 'nanomessage is not open', true)
export const NM_ERR_CANCEL = createError('NM_ERR_CANCEL', '%o', true)
