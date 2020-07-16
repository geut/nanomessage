const RPC = require('arpeecee')
const through = require('through2')
const duplexify = require('duplexify')
const codec = require('./lib/codec')
const bufferJson = require('buffer-json-encoding')


const { Nanomessage } = require('.')
const Request = require('./lib/request')
const schema = require('./lib/schema')
const varint = require('varint')

function encode (info) {
  try {
    return schema.Request.encode({ ...info, data: codec.encode(info.data) })
  } catch (err) {
    throw new Error(err.message)
  }
}

function decode (buff) {
  try {
    const request = schema.Request.decode(buff)
    if (!request.id) {
      const err = new Error('noo')
      err.request = request
      throw err
    }
    request.data = codec.decode(request.data)
    return request
  } catch (err) {
    throw new Error(err.message)
  }
}

const stream1 = new RPC({
  errorEncoding: bufferJson
})

// define a method
const aMethod1 = stream1.defineService({ id: 1 })
  .defineMethod({
    id: 1,
    requestEncoding: bufferJson,
    responseEncoding: bufferJson,
    async onrequest (value) {
      return { value: 'test' }
    }
  })

const stream2 = new RPC({
  errorEncoding: bufferJson
})

// define a method

const aMethod2 = stream2.defineService({ id: 1 })
  .defineMethod({
    id: 1,
    requestEncoding: bufferJson,
    responseEncoding: bufferJson,
    async onrequest (value) {
      return { value: 'test' }
    }
  })

stream1.pipe(stream2).pipe(stream1)

;(async () => {
  console.time('test')
  await Promise.all([
    Promise.all([...Array(10000).keys()].map(i => {
      return aMethod1.request({ value: 'test' })
    })),
    Promise.all([...Array(10000).keys()].map(i => {
      return aMethod2.request({ value: 'test' })
    }))
  ])
  // await wait
  console.timeEnd('test')
})()
