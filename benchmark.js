const eos = require('end-of-stream')
const { Duplex } = require('streamx')
const { Nanomessage } = require('.')

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

;(async () => {
  await test()
})()
