import nanoerror from 'nanoerror'

export const NMSG_ERR_TIMEOUT = nanoerror('NMSG_ERR_TIMEOUT', 'timeout on request: %s')
export const NMSG_ERR_ENCODE = nanoerror('NMSG_ERR_ENCODE', 'error encoding the request: %s')
export const NMSG_ERR_DECODE = nanoerror('NMSG_ERR_DECODE', 'error decoding the request: %s')
export const NMSG_ERR_RESPONSE = nanoerror('NMSG_ERR_RESPONSE', 'response error on request: %s')
export const NMSG_ERR_CLOSE = nanoerror('NMSG_ERR_CLOSE', 'nanomessage was closed')
export const NMSG_ERR_NOT_OPEN = nanoerror('NMSG_ERR_NOT_OPEN', 'nanomessage is not open')
export const NMSG_ERR_CANCEL = nanoerror('NMSG_ERR_CANCEL', 'request canceled: %s')
