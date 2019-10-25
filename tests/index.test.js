const through = require('through2')
const duplexify = require('duplexify')

const { createFromSocket } = require('..')

const createConnection = (aliceOpts = {}, bobOpts = {}) => {
  const t1 = through()
  const t2 = through()

  const alice = createFromSocket(duplexify(t1, t2), aliceOpts)
  const bob = createFromSocket(duplexify(t2, t1), bobOpts)
  return { alice, bob }
}

test('simple', async () => {
  expect.assertions(4)

  const { alice, bob } = createConnection(
    {
      onmessage: (data) => {
        expect(data).toBe('ping from bob')
        return 'pong from alice'
      }
    },
    {
      onmessage: (data) => {
        expect(data).toBe('ping from alice')
        return 'pong from bob'
      }
    }
  )

  await expect(alice.request('ping from alice')).resolves.toBe('pong from bob')
  await expect(bob.request('ping from bob')).resolves.toBe('pong from alice')
})

test('timeout', async () => {
  const { bob } = createConnection(
    {
      onmessage: async () => {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    },
    {
      timeout: 1000
    }
  )

  await expect(bob.request('ping from bob')).rejects.toThrow('Timeout on request.')
})
