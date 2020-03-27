const through = require('through2')
const duplexify = require('duplexify')

const nanomessage = require('..')
const {
  NMSG_ERR_TIMEOUT,
  NMSG_ERR_CANCEL,
  NMSG_ERR_CLOSE
} = require('../lib/errors')

const { createFromStream } = nanomessage

const createConnection = (aliceOpts = { onMessage () {} }, bobOpts = { onMessage () {} }) => {
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
      onMessage: (data) => {
        expect(data).toEqual(Buffer.from('ping from bob'))
        return Buffer.from('pong from alice')
      }
    },
    {
      onMessage: (data) => {
        expect(data).toBe('ping from alice')
        return 'pong from bob'
      }
    }
  )

  await expect(alice.request('ping from alice')).resolves.toBe('pong from bob')
  await expect(bob.request(Buffer.from('ping from bob'))).resolves.toEqual(Buffer.from('pong from alice'))
})

test('timeout', async () => {
  expect.assertions(1)

  const { bob } = createConnection(
    {
      onMessage: async () => {
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
  expect.assertions(3)

  const _onCancel = jest.fn()

  const { bob, alice } = createConnection(
    {
      onMessage: async (msg, { onCancel }) => {
        onCancel(_onCancel)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    },
    {
      timeout: 1000
    }
  )

  const onError = new Promise((resolve, reject) => alice.once('subscribe-error', reject))

  const request = bob.request('ping from bob')
  setTimeout(() => request.cancel(), 0)
  await expect(request).rejects.toThrow(NMSG_ERR_CANCEL)
  await expect(onError).rejects.toThrow(/cancel/)
  expect(_onCancel).toHaveBeenCalledTimes(1)
})

test('automatic cleanup requests', async (done) => {
  expect.assertions(6)

  const { alice, bob } = createConnection({
    onMessage () {}
  }, {
    onMessage () {}
  })

  expect(alice.requests.length).toBe(0)
  expect(bob.requests.length).toBe(0)

  const aliceTen = Array.from(Array(10).keys()).map(() => bob.request('message'))
  const bobTen = Array.from(Array(10).keys()).map(() => bob.request('message'))

  process.nextTick(async () => {
    expect(bob.requests.length).toBe(20)
    expect(alice.requests.length).toBe(20)

    await Promise.all([...aliceTen, ...bobTen])

    expect(alice.requests.length).toBe(0)
    expect(bob.requests.length).toBe(0)

    done()
  })
})

test('close', async (done) => {
  expect.assertions(6)

  const { alice, bob } = createConnection()

  alice.once('subscribe-error', err => {
    expect(err.code).toBe('NMSG_ERR_RESPONSE')
    done()
  })

  const request = bob.request('message')

  const closing = expect(request).rejects.toThrow(NMSG_ERR_CLOSE)

  alice.once('task-pending', req => {
    expect(request.id).toBe(req.id)
  })

  expect(bob.requests.length).toBe(1)

  process.nextTick(() => {
    expect(bob.close()).resolves.toBeUndefined()
  })

  await closing

  expect(bob.requests.length).toBe(0)
})

test('detect invalid request', (done) => {
  expect.assertions(2)

  const { alice, bob } = createConnection()

  alice.once('subscribe-error', err => {
    expect(err.code).toBe('NMSG_ERR_INVALID_REQUEST')
    alice.once('subscribe-error', err => {
      expect(err.code).toBe('NMSG_ERR_DECODE')
      done()
    })
  })

  bob.stream.write(Buffer.from(JSON.stringify({ msg: 'not valid' })))
  bob.stream.write('not valid')
})

test('send ephemeral message', async (done) => {
  expect.assertions(4)

  let messages = 2

  const { alice, bob } = createConnection(
    {
      onMessage: (data, { ephemeral }) => {
        expect(ephemeral).toBe(true)
        expect(data).toEqual(Buffer.from('ping from bob'))
        messages--
        if (messages === 0) {
          done()
        }
      }
    },
    {
      onMessage: (data, { ephemeral }) => {
        expect(ephemeral).toBe(true)
        expect(data).toBe('ping from alice')
        messages--
        if (messages === 0) {
          done()
        }
      }
    }
  )
  await alice.send('ping from alice')
  await bob.send(Buffer.from('ping from bob'))
})

test('concurrency', async () => {
  expect.assertions(1)

  const { alice, bob } = createConnection(
    {
      concurrency: 2
    },
    {
      concurrency: 2
    }
  )

  alice.request('ping from alice').catch(() => {})
  alice.request('ping from alice').catch(() => {})

  expect(alice.isFull).toBe(true)

  await Promise.all([alice.close(), bob.close()])
})
