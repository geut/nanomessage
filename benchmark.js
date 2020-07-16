const eos = require('end-of-stream')
const { Duplex } = require('streamx')
const duplexify = require('duplexify')
const codec = require('./lib/codec')
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

function createFromStream (stream, options = {}) {
  const { onSend = () => {}, onClose = () => {}, ...nmOptions } = options

  const nm = new Nanomessage(Object.assign({
    subscribe (ondata) {
      stream.on('data', (data) => {
        ondata(data)
      })
    },
    send (chunk, info) {
      // onSend(chunk, info)
      // if (stream.destroyed) return
      stream.write(chunk)
    },
    close () {
      onClose()
      if (stream.destroyed) return
      return new Promise(resolve => {
        eos(stream, () => resolve())
        stream.destroy()
      })
    }
  }, nmOptions))

  nm.open().catch((err) => {
    console.log(err)
  })

  stream.on('close', () => {
    nm.close()
  })

  nm.stream = stream

  return nm
}

function create (aliceOpts = { onMessage () {} }, bobOpts = { onMessage () {} }) {
  const stream1 = new Duplex({
    write (data, cb) {
      stream2.push(data)
      cb()
    }
  })
  const stream2 = new Duplex({
    write (data, cb) {
      stream1.push(data)
      cb()
    }
  })

  const alice = createFromStream(stream1, aliceOpts)
  const bob = createFromStream(stream2, bobOpts)

  return [alice, bob]
}

function create2 (aliceOpts = { onMessage () {} }, bobOpts = { onMessage () {} }) {
  const stream1 = new Duplex({
    write (data, cb) {
      stream2.push(data)
      cb()
    }
  })
  const stream2 = new Duplex({
    write (data, cb) {
      stream1.push(data)
      cb()
    }
  })

  return [stream1, stream2]
}

async function test () {
  const [alice, bob] = create()
  await alice.open()
  await bob.open()

  const aliceTotal = 0
  const bobTotal = 0

  const max = 10000
  // const wait = new Promise(resolve => {
  //   alice.setMessageHandler(data => {
  //     aliceTotal++
  //     if (aliceTotal === max && bobTotal === max) resolve()
  //   })
  //   bob.setMessageHandler(data => {
  //     bobTotal++
  //     if (aliceTotal === max && bobTotal === max) resolve()
  //   })
  // })
  console.time('test')
  await Promise.all([
    Promise.all([...Array(max).keys()].map(i => {
      return alice.request('test')
    })),
    Promise.all([...Array(max).keys()].map(i => {
      return bob.request('test')
    }))
  ])
  // await wait
  console.timeEnd('test')
}

async function test2 () {
  const [alice, bob] = create2()
  let aliceTotal = 0
  let bobTotal = 0

  const max = 10000
  const wait = new Promise(resolve => {
    alice.on('data', (data) => {
      data = decode(data)
      if (!data.response) {
        bob.write(encode({ id: data.id, data: 'holaaa', response: true }))
        return
      }
      aliceTotal++
      if (aliceTotal === max && bobTotal === max) resolve()
    })
    bob.on('data', (data) => {
      data = decode(data)
      if (!data.response) {
        alice.write(encode({ id: data.id, data: 'holaaa', response: true }))
        return
      }
      bobTotal++
      if (aliceTotal === max && bobTotal === max) resolve()
    })
  })

  console.time('test')
  await Promise.all([
    Promise.all([...Array(max).keys()].map(i => {
      const info = Request.info({ id: Request.uuid(), data: 'test', ephemeral: true })
      alice.write(encode(info))
    })),
    Promise.all([...Array(max).keys()].map(i => {
      const info = Request.info({ id: Request.uuid(), data: 'test', ephemeral: true })
      bob.write(encode(info))
    }))
  ])
  await wait
  console.timeEnd('test')
}

;(async () => {
  // await test2()
  await test()
})()
