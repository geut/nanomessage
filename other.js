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
    async onrequest (value) {
      const data = decode(value)
      return encode({ id: data.id, data: 'holaaa', response: true })
    }
  })

const stream2 = new RPC({
  errorEncoding: bufferJson
})

// define a method

const aMethod2 = stream2.defineService({ id: 1 })
  .defineMethod({
    id: 1,
    async onrequest (value) {
      const data = decode(value)
      return encode({ id: data.id, data: 'holaaa', response: true })
    }
  })

stream1.pipe(stream2).pipe(stream1)

;(async () => {
  console.time('test')
  await Promise.all([
    Promise.all([...Array(10000).keys()].map(i => {
      const info = Request.info({ id: Request.uuid(), data: 'test', ephemeral: true })
      aMethod1.request(encode(info))
    })),
    Promise.all([...Array(10000).keys()].map(i => {
      const info = Request.info({ id: Request.uuid(), data: 'test', ephemeral: true })
      aMethod2.request(encode(info))
    }))
  ])
  // await wait
  console.timeEnd('test')
})()
