const bufferJson = require('buffer-json-encoding')

module.exports = {
  encode (data) {
    return bufferJson.encode({ data })
  },
  decode (buf) {
    return bufferJson.decode(buf).data
  }
}
