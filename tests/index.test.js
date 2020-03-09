const through = require('through2')
const duplexify = require('duplexify')

const nanomessage = require('..')
const {
  NMSG_ERR_TIMEOUT,
  NMSG_ERR_CLOSE,
  NMSG_ERR_CANCEL
} = require('../lib/errors')

const { createFromStream, symbols: { kRequests } } = nanomessage

const createConnection = (aliceOpts = { onRequest () {} }, bobOpts = { onRequest () {} }) => {
  const t1 = through()
  const t2 = through()

  const stream1 = duplexify(t1, t2)
  const alice = createFromStream(stream1, aliceOpts)

  const stream2 = duplexify(t2, t1)
  const bob = createFromStream(stream2, bobOpts)

  return { alice, bob }
}

test('configuration', () => {
  expect(() => nanomessage()).toThrow(/send is required/)
})

test('simple', async () => {
  expect.assertions(4)

  const { alice, bob } = createConnection(
    {
      onRequest: (data) => {
        expect(data).toEqual(Buffer.from('ping from bob'))
        return Buffer.from('pong from alice')
      }
    },
    {
      onRequest: (data) => {
        expect(data).toBe('ping from alice')
        return 'pong from bob'
      }
    }
  )

  await expect(alice.request('ping from alice')).resolves.toBe('pong from bob')
  await expect(bob.request(Buffer.from('ping from bob'))).resolves.toEqual(Buffer.from('pong from alice'))
})

test('timeout', async () => {
  const { bob } = createConnection(
    {
      onRequest: async () => {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    },
    {
      timeout: 1000
    }
  )

  const request = bob.request('ping from bob')
  await expect(request).rejects.toThrow(NMSG_ERR_TIMEOUT)
})

test('cancel', async () => {
  const { bob } = createConnection(
    {
      onRequest: async () => {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    },
    {
      timeout: 1000
    }
  )

  const request = bob.request('ping from bob')
  setTimeout(() => request.cancel(), 0)
  await expect(request).rejects.toThrow(NMSG_ERR_CANCEL)
})

test('automatic cleanup requests', async () => {
  const { bob } = createConnection({
    onRequest () {}
  }, {
    onRequest () {}
  })

  expect(bob[kRequests].size).toBe(0)

  const ten = Array.from(Array(10).keys()).map(() => bob.request('message'))

  expect(bob[kRequests].size).toBe(10)

  await Promise.all(ten)

  expect(bob[kRequests].size).toBe(0)
})

test('close', async (done) => {
  expect.assertions(6)

  const { alice, bob } = createConnection()

  alice.stream.once('error', err => {
    expect(err.code).toBe('NMSG_ERR_RESPONSE')
    done()
  })

  const request = bob.request('message')

  const closing = expect(request).rejects.toThrow(NMSG_ERR_CLOSE)

  alice.once('task-pending', req => {
    expect(request.id).toBe(req.id)
  })

  expect(bob[kRequests].size).toBe(1)

  process.nextTick(() => {
    expect(bob.close()).resolves.toBeUndefined()
  })

  await closing

  expect(bob[kRequests].size).toBe(0)
})

test('detect invalid request', async () => {
  const { alice, bob } = createConnection()

  alice.stream.once('error', err => {
    expect(err.code).toBe('NMSG_ERR_INVALID_REQUEST')
    alice.stream.once('error', err => {
      expect(err.code).toBe('NMSG_ERR_DECODE')
    })
  })

  bob.stream.write(Buffer.from(JSON.stringify({ msg: 'not valid' })))
  bob.stream.write('not valid')
})
