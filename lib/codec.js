module.exports = {
  encode (obj) {
    return Buffer.from(JSON.stringify(obj, (key, value) => {
      if (key === 'nmData' && value && value.type === 'Buffer') {
        return {
          b: 1,
          d: value.data
        }
      }

      return value
    }))
  },
  decode (buff) {
    return JSON.parse(buff, (key, value) => {
      if (key === 'nmData' && value && value.b && value.d) {
        return Buffer.from(value.d)
      }

      return value
    })
  }
}
