const through = require('through2')
const duplexify = require('duplexify')

const { createFromSocket, symbols: { kRequests } } = require('..')
const {
  NMSG_ERR_TIMEOUT,
  NMSG_ERR_CLOSE,
  NMSG_ERR_CANCEL
} = require('../lib/errors')

const createConnection = (aliceOpts = {}, bobOpts = {}) => {
  const t1 = through()
  const t2 = through()

  const stream1 = duplexify(t1, t2)
  const alice = createFromSocket(stream1, aliceOpts)

  const stream2 = duplexify(t2, t1)
  const bob = createFromSocket(stream2, bobOpts)
  return { alice, bob }
}

test('simple', async () => {
  expect.assertions(4)

  const { alice, bob } = createConnection(
    {
      onrequest: (data) => {
        expect(data).toEqual(Buffer.from('ping from bob'))
        return Buffer.from('pong from alice')
      }
    },
    {
      onrequest: (data) => {
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
      onrequest: async () => {
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
      onrequest: async () => {
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
  const { bob } = createConnection()

  expect(bob[kRequests].size).toBe(0)

  const ten = Array.from(Array(10).keys()).map(() => bob.request('message'))

  expect(bob[kRequests].size).toBe(10)

  await Promise.all(ten)

  expect(bob[kRequests].size).toBe(0)
})

test('close', async () => {
  expect.assertions(4)

  const { bob } = createConnection(
    { onrequest: () => new Promise(resolve => setTimeout(resolve, 1000)) }
  )

  const finish = expect(bob.request('message')).rejects.toThrow(NMSG_ERR_CLOSE)

  expect(bob[kRequests].size).toBe(1)

  setTimeout(() => expect(bob.close()).resolves.toBeUndefined(), 1)

  await finish

  expect(bob[kRequests].size).toBe(0)
})

test('detect invalid request', async () => {
  const { alice, bob } = createConnection()

  alice.socket.once('nanomessage-error', err => {
    expect(err.code).toBe('NMSG_ERR_INVALID_REQUEST')
    alice.socket.once('nanomessage-error', err => {
      expect(err.code).toBe('NMSG_ERR_DECODE')
    })
  })

  bob.socket.write(Buffer.from(JSON.stringify({ msg: 'not valid' })))
  bob.socket.write('not valid')
})
