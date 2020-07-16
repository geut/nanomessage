const eos = require('end-of-stream')
const through = require('through2')
const duplexify = require('duplexify')

const { Nanomessage } = require('..')

function createFromStream (stream, options = {}) {
  const { onSend = () => {}, onClose = () => {}, ...nmOptions } = options

  const nm = new Nanomessage(Object.assign({
    subscribe (ondata) {
      stream.on('data', (data) => {
        try {
          ondata(data)
        } catch (err) {
          nm.emit('subscribe-error', err)
        }
      })
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

module.exports = function create (aliceOpts = { onMessage () {} }, bobOpts = { onMessage () {} }) {
  const t1 = through()
  const t2 = through()

  const stream1 = duplexify(t1, t2)
  const alice = createFromStream(stream1, aliceOpts)

  const stream2 = duplexify(t2, t1)
  const bob = createFromStream(stream2, bobOpts)

  return [alice, bob]
}
