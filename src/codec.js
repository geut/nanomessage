import { Packr } from 'msgpackr'

import { RequestInfo } from './request.js'
import {
  encodeError,
  decodeError,
  NM_ERR_ENCODE,
  NM_ERR_DECODE
} from './errors.js'

const ATTR_RESPONSE = 1
const ATTR_ERROR = 1 << 1

export const createPackr = (opts = {}) => {
  return new Packr({
    useRecords: true,
    ...opts
  })
}

const staticPackr = createPackr({
  structures: [
    ['id', 'header', 'data'],
    ['code', 'unformatMessage', 'args', 'metadata']
  ]
})

const dynamicPackr = createPackr()
const defaultValueEncoding = {
  encode: (data) => dynamicPackr.pack(data),
  decode: (data) => dynamicPackr.unpack(data)
}

export function createCodec (valueEncoding = defaultValueEncoding) {
  return {
    encode (info) {
      try {
        let header = 0
        if (info.response) header = header | ATTR_RESPONSE
        if (info.error) header = header | ATTR_ERROR

        let data = info.response ? info.responseData : info.data
        data = info.error ? encodeError(data) : data
        const buf = staticPackr.pack({
          id: info.id,
          header,
          data: info.error ? staticPackr.pack(data) : valueEncoding.encode(data)
        })
        return buf
      } catch (err) {
        throw NM_ERR_ENCODE.from(err)
      }
    },

    decode (buf, context) {
      try {
        const { id, header, data } = staticPackr.unpack(buf)

        const response = !!(header & ATTR_RESPONSE)
        const error = !!(header & ATTR_ERROR)

        return new RequestInfo(
          id,
          response,
          error,
          context,
          null,
          () => {
            if (error) return decodeError(staticPackr.unpack(data))
            return valueEncoding.decode(data)
          }
        )
      } catch (err) {
        throw NM_ERR_DECODE.from(err)
      }
    }
  }
}
