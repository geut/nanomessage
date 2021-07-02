import { jest } from '@jest/globals'
import { AbortController } from 'abortcontroller-polyfill/dist/abortcontroller.js'

import create from './create.js'

import { Nanomessage } from '../src/nanomessage.js'
import { NMSG_ERR_TIMEOUT, NMSG_ERR_CANCEL, NMSG_ERR_CLOSE } from '../src/errors.js'

test('basic', async () => {
  expect.assertions(15)

  const onSend = jest.fn()

  const [alice, bob] = create(
    {
      onMessage: (data, info) => {
        expect(info.id).not.toBeUndefined()
        expect(info.ephemeral).toBe(false)
        expect(info.response).toBe(true)
        expect(data).toEqual(Buffer.from('ping from bob'))
        return Buffer.from('pong from alice')
      },
      onSend: (data, info) => {
        expect(Buffer.isBuffer(data)).toBe(true)
        expect(info.id).not.toBeUndefined()
        if (info.args) {
          expect(info.args.optionalInformation).toBe(true)
        }
        onSend({ ...info, id: undefined })
      }
    },
    {
      onMessage: (data, info) => {
        expect(data).toBe('ping from alice')
        return 'pong from bob'
      }
    }
  )

  await expect(alice.request('ping from alice', { args: { optionalInformation: true } })).resolves.toBe('pong from bob')
  await expect(bob.request(Buffer.from('ping from bob'))).resolves.toEqual(Buffer.from('pong from alice'))

  expect(onSend).toHaveBeenCalledTimes(2)
  expect(onSend).toHaveBeenNthCalledWith(1, { data: 'ping from alice', ephemeral: false, response: false, args: { optionalInformation: true } })
  expect(onSend).toHaveBeenNthCalledWith(2, { data: Buffer.from('ping from bob'), responseData: Buffer.from('pong from alice'), ephemeral: false, response: true })
})

test('timeout', async () => {
  expect.assertions(1)

  const [alice] = create(
    {
      timeout: 1000
    },
    {
      onMessage: async () => {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
  )

  const request = alice.request('ping')
  await expect(request).rejects.toThrow(NMSG_ERR_TIMEOUT)
})

test('cancel', async () => {
  expect.assertions(1)

  const [alice] = create(
    {},
    {
      onMessage: async () => {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  )

  const request = alice.request('ping')
  setTimeout(() => request.cancel(), 500)
  await expect(request).rejects.toThrow(NMSG_ERR_CANCEL)
})

test('automatic cleanup requests', async () => {
  expect.assertions(6)

  const [alice, bob] = create({
    onMessage () {}
  }, {
    onMessage () {}
  })

  expect(alice.requests.length).toBe(0)
  expect(bob.requests.length).toBe(0)

  const aliceTen = Array.from(Array(10).keys()).map(() => alice.request('message'))
  const bobTen = Array.from(Array(10).keys()).map(() => bob.request('message'))

  expect(bob.requests.length).toBe(10)
  expect(alice.requests.length).toBe(10)

  await Promise.all([...aliceTen, ...bobTen])

  expect(alice.requests.length).toBe(0)
  expect(bob.requests.length).toBe(0)
})

test('close', async () => {
  expect.assertions(5)

  const [alice, bob] = create()

  const request = bob.request('message')

  const closing = expect(request).rejects.toThrow(NMSG_ERR_CLOSE)

  expect(bob.requests.length).toBe(1)

  await expect(alice.close()).resolves.toBeUndefined()
  await expect(bob.close()).resolves.toBeUndefined()
  await closing

  expect(bob.requests.length).toBe(0)
})

test('detect invalid request', (done) => {
  expect.assertions(1)

  const [alice, bob] = create()

  alice.once('subscribe-error', err => {
    expect(err.code).toBe('NMSG_ERR_DECODE')
    done()
  })

  bob.stream.write('not valid')
})

test('send ephemeral message', async () => {
  expect.assertions(4)

  let messages = 2
  const done = {}
  done.promise = new Promise(resolve => {
    done.resolve = resolve
  })

  const [alice, bob] = create(
    {
      onMessage: (data, { ephemeral }) => {
        expect(ephemeral).toBe(true)
        expect(data).toEqual(Buffer.from('ping from bob'))
        messages--
        if (messages === 0) {
          done.resolve()
        }
      }
    },
    {
      onMessage: (data, { ephemeral }) => {
        expect(ephemeral).toBe(true)
        expect(data).toBe('ping from alice')
        messages--
        if (messages === 0) {
          done.resolve()
        }
      }
    }
  )

  await alice.send('ping from alice')
  await bob.send(Buffer.from('ping from bob'))

  return done.promise
})

test('concurrency', async () => {
  expect.assertions(1)

  const [alice, bob] = create(
    {
      concurrency: 2
    },
    {
      concurrency: 2
    }
  )

  alice.request('ping from alice').catch(() => {})
  alice.request('ping from alice').catch(() => {})

  expect(alice.inflightRequests).toBe(2)

  await Promise.all([alice.close(), bob.close()])
})

test('abort signal', async () => {
  expect.assertions(2)

  const [alice] = create(
    {},
    {
      onMessage: async () => {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  )

  {
    const controller = new AbortController()
    const signal = controller.signal
    controller.abort()
    const request = alice.request('ping', { signal })
    await expect(request).rejects.toThrow(NMSG_ERR_CANCEL)
  }

  {
    const controller = new AbortController()
    const signal = controller.signal
    const request = alice.request('ping', { signal })
    setTimeout(() => controller.abort(), 500)
    await expect(request).rejects.toThrow(NMSG_ERR_CANCEL)
  }
})

test('processIncomingMessage', async () => {
  const messageArgs = []

  const alice = new Nanomessage({
    send: (data, info) => {
      messageArgs.push(info.args)
      bob.processIncomingMessage(data, {
        args: info.args
      })
    },
    onMessage: (_, info) => {
      messageArgs.push(info.args)
    }
  })

  const bob = new Nanomessage({
    send: (data) => {
      alice.processIncomingMessage(data)
    }
  })

  await alice.open()
  await bob.open()

  await alice.request('ping', { args: 'randomData' })
  expect(messageArgs).toEqual(['randomData'])
})
