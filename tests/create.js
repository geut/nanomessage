import { Duplex } from 'streamx'

import { Nanomessage } from '../src/nanomessage.js'

function createFromStream (stream, options = {}) {
  const { onSend = () => {}, onClose = () => {}, ...nmOptions } = options

  const nm = new Nanomessage(Object.assign({
    subscribe (ondata) {
      stream.on('data', (data) => {
        ondata(data).catch(err => {
          nm.emit('subscribe-error', err)
        })
      })

      return () => {
        nm.emit('unsubscribe')
      }
    },
    send (chunk, info) {
      onSend(chunk, info)
      if (stream.destroyed) return
      stream.write(chunk)
    },
    close () {
      onClose()
      if (stream.destroyed) return
      return new Promise(resolve => {
        stream.once('close', () => resolve())
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

export default function create (aliceOpts = { onMessage () {} }, bobOpts = { onMessage () {} }) {
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
