import { test } from 'uvu'
import * as assert from 'uvu/assert'
import { spy } from 'tinyspy'

import { AbortController } from 'abortcontroller-polyfill/dist/abortcontroller.js'

import create from './create.js'

import {
  Nanomessage,
  createError,
  VOID_RESPONSE,
  NM_ERR_TIMEOUT,
  NM_ERR_CANCEL,
  NM_ERR_CLOSE,
  NM_ERR_MESSAGE,
  NM_ERR_NOT_OPEN,
  NM_ERR_REMOTE_RESPONSE,
  NM_ERR_ENCODE
} from '../src/index.js'

const assertThrow = async (p, ErrorClass) => {
  try {
    await p
    assert.unreachable('should have thrown')
  } catch (err) {
    if (ErrorClass.isNanoerror) {
      assert.ok(ErrorClass.equals(err), `expect code: ${ErrorClass.code} resolve: ${err}`)
    } else {
      assert.instance(err, ErrorClass)
    }
  }
}

test('basic', async () => {
  const onSend = spy((data, info) => {
    assert.ok(Buffer.isBuffer(data))
    assert.is.not(info.id, undefined)
    if (!info.response) {
      assert.ok(info.context.optionalInformation)
    }

    return { ...info.toJSON(), id: undefined }
  })

  const onError = spy()

  const [alice, bob] = create(
    {
      onMessage: spy((data, info) => {
        assert.equal(data, Buffer.from('ping from bob'))
        assert.is.not(info.id, undefined)
        assert.is(info.ephemeral, false)
        assert.is(info.response, false)
        assert.equal(info.data, data)
        return Buffer.from('pong from alice')
      }),
      onSend
    },
    {
      onMessage: spy((data) => {
        assert.equal(data, 'ping from alice')
        return 'pong from bob'
      })
    }
  )

  alice.on('message-error', onError)
  bob.on('message-error', onError)

  assert.equal(await alice.request('ping from alice', { context: { optionalInformation: true } }), 'pong from bob')
  assert.equal(await bob.request(Buffer.from('ping from bob')), Buffer.from('pong from alice'))
  assert.ok(!onError.called, 'should not get a message error')

  assert.is(alice._onMessage.callCount, 1)
  assert.is(bob._onMessage.callCount, 1)

  assert.is(onSend.callCount, 2)
  assert.equal(onSend.results[0][1], { id: undefined, responseData: undefined, data: 'ping from alice', ephemeral: false, response: false, error: false, context: { optionalInformation: true } })
  assert.equal(onSend.results[1][1], { id: undefined, data: Buffer.from('ping from bob'), responseData: Buffer.from('pong from alice'), ephemeral: false, response: true, error: false, context: {} })
})

test('options', () => {
  const [alice] = create({ timeout: 1000 })

  assert.not.type(alice.codec, undefined)

  assert.is(alice.requestTimeout, 1000)

  assert.equal(alice.concurrency, {
    incoming: 256,
    outgoing: 256
  })

  alice.setConcurrency({
    incoming: 1,
    outgoing: 2
  })
  assert.equal(alice.concurrency, {
    incoming: 1,
    outgoing: 2
  })

  alice.setConcurrency({
    incoming: 10
  })
  assert.equal(alice.concurrency, {
    incoming: 10,
    outgoing: 2
  })

  alice.setConcurrency({
    outgoing: 15
  })
  assert.equal(alice.concurrency, {
    incoming: 10,
    outgoing: 15
  })
})

test('timeout', async () => {
  const [alice] = create(
    {
      timeout: 100
    },
    {
      onMessage: async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
  )

  await assertThrow(alice.request('ping'), NM_ERR_TIMEOUT)
})

test('automatic cleanup requests', async () => {
  const [alice, bob] = create({
    onMessage () {}
  }, {
    onMessage () {}
  })

  assert.is(alice.requests.length, 0)
  assert.is(bob.requests.length, 0)

  const aliceTen = Array.from(Array(10).keys()).map(() => alice.request('message'))
  const bobTen = Array.from(Array(10).keys()).map(() => bob.request('message'))

  assert.is(bob.requests.length, 10)
  assert.is(alice.requests.length, 10)

  await Promise.all([...aliceTen, ...bobTen])

  assert.is(alice.requests.length, 0)
  assert.is(bob.requests.length, 0)
})

test('close', async () => {
  const [alice, bob] = create()

  const request = bob.request('message')

  assert.is(bob.requests.length, 1)

  await Promise.all([
    Nanomessage.once(alice, 'unsubscribe'),
    Nanomessage.once(bob, 'unsubscribe'),
    assertThrow(request, NM_ERR_CLOSE),
    alice.close(),
    bob.close()
  ])

  assert.is(bob.requests.length, 0)
  await assertThrow(alice.send('test'), NM_ERR_CLOSE)
})

test('detect invalid request', async () => {
  const [alice, bob] = create()

  queueMicrotask(() => bob.stream.write('not valid'))
  const [error] = await Nanomessage.once(alice, 'subscribe-error')
  assert.is(error.code, 'NM_ERR_DECODE')
})

test('custom valueEncoding', async () => {
  const valueEncoding = {
    encode (data) {
      if (typeof data === 'number') throw new Error('test')
      return Buffer.from(data)
    },
    decode (buf) {
      return buf.toString('utf8')
    }
  }

  const [alice] = create({ valueEncoding }, { valueEncoding, onMessage: () => 'hi' })

  const bobMessage = await alice.request('hello')
  assert.is(bobMessage, 'hi')
  await assertThrow(alice.request(2), NM_ERR_ENCODE)
})

test('void response', async () => {
  const [alice] = create({ onMessage: () => {} }, { onMessage: () => VOID_RESPONSE })
  await assertThrow(alice.request('hello', { timeout: 100 }), NM_ERR_TIMEOUT)
})

test('send ephemeral message', async () => {
  const onError = spy()

  const [alice, bob] = create(
    {
      onMessage: spy((data, { ephemeral }) => {
        assert.is(ephemeral, true)
        assert.equal(data, Buffer.from('ping from bob'))
      })
    },
    {
      onMessage: spy((data, { ephemeral }) => {
        assert.is(ephemeral, true)
        assert.is(data, 'ping from alice')
      })
    }
  )

  alice.on('message-error', onError)
  bob.on('message-error', onError)

  await Promise.all([
    alice.send('ping from alice'),
    bob.send(Buffer.from('ping from bob')),
    Nanomessage.once(alice, 'message'),
    Nanomessage.once(bob, 'message')
  ])

  await new Promise(resolve => setTimeout(resolve, 100))

  assert.ok(!onError.called, 'should not get a message error')
})

test('concurrency', async () => {
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
  alice.request('ping from alice').catch(() => {}) // this request will wait, only 2 inflightRequests

  assert.is(alice.inflightRequests, 2)

  await Promise.all([alice.close(), bob.close()])
})

test('abort signal', async () => {
  const [alice] = create(
    {},
    {
      onMessage: async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'pong'
      }
    }
  )

  const ErrorCustom = createError('CUSTOM')

  {
    const controller = new AbortController()
    const signal = controller.signal
    controller.abort()
    const request = alice.request('ping', { signal })
    await assertThrow(request, NM_ERR_CANCEL)
  }

  {
    const controller = new AbortController()
    const signal = controller.signal
    controller.abort()
    const request = alice.request('ping', { signal, onCancel: () => new ErrorCustom() })
    await assertThrow(request, ErrorCustom)
  }

  {
    const onCancelFn = spy()
    const controller = new AbortController()
    const signal = controller.signal
    controller.abort()
    const request = alice.request('ping', { signal, onCancel: onCancelFn })
    await assertThrow(request, NM_ERR_CANCEL)
    assert.ok(onCancelFn.called)
  }

  {
    const controller = new AbortController()
    const signal = controller.signal
    const request = alice.request('ping', { signal })
    setTimeout(() => controller.abort(), 50)
    await assertThrow(request, NM_ERR_CANCEL)
  }

  {
    const controller = new AbortController()
    const signal = controller.signal
    const request = alice.request('ping', { signal, timeout: 150 })
    await new Promise(resolve => setTimeout(resolve, 110))
    controller.abort()
    assert.is(await request, 'pong')
  }
})

test('processIncomingMessage', async () => {
  const messageContext = []

  const alice = new Nanomessage({
    send: (data, info) => {
      messageContext.push(info.context)
      bob.processIncomingMessage(data, {
        context: info.context
      })
    },
    onMessage: (_, info) => {
      messageContext.push(info.context)
    }
  })

  const bob = new Nanomessage({
    send: (data) => {
      alice.processIncomingMessage(data)
    }
  })

  await alice.open()
  await bob.open()

  await alice.request('ping', { context: 'randomData' })
  assert.equal(messageContext, ['randomData'])
})

test('valueEncoding', async () => {
  const onEncode = spy()
  const onDecode = spy()

  const valueEncoding = {
    encode (obj) {
      onEncode()
      return JSON.stringify(obj)
    },
    decode (str) {
      onDecode()
      return JSON.parse(str)
    }
  }

  const alice = new Nanomessage({
    valueEncoding,
    send: (data, info) => {
      bob.processIncomingMessage(data)
    },
    onMessage: (data, info) => {
      assert.is(data, 'ping')
      return 'pong'
    }
  })

  const bob = new Nanomessage({
    valueEncoding,
    send: (data) => {
      alice.processIncomingMessage(data)
    }
  })

  await alice.open()
  await bob.open()

  const res = await bob.request('ping')
  assert.is(res, 'pong')

  assert.is(onEncode.callCount, 2)
  assert.is(onDecode.callCount, 2)
})

test('create a request over a closed resource', async () => {
  const [alice] = create()
  await alice.close()
  // do nothing with incoming messages
  await alice.processIncomingMessage()
  await assertThrow(alice.request('test'), NM_ERR_CLOSE)
})

test('error-message', async () => {
  const [alice, bob] = create({ onMessage: () => { throw new Error('oh no') } })

  const result = Nanomessage.once(alice, 'message-error')
  await bob.send('test')
  const [error] = await result
  assert.is(error.code, NM_ERR_MESSAGE.code)
  await assertThrow(bob.request('test'), NM_ERR_REMOTE_RESPONSE)
})

test('nanoerror error-message', async () => {
  const Err = createError('ERR', 'oh no')
  const [alice, bob] = create({ onMessage: () => { throw new Err() } })

  const result = Nanomessage.once(alice, 'message-error')
  await bob.send('test')
  const [error] = await result
  assert.instance(error, Err)

  await assertThrow(bob.request('test'), Err)
})

test('send-error', async () => {
  const [alice, bob] = create({
    send: () => {
      throw new Error('send error')
    }
  })

  const result = Nanomessage.once(alice, 'message-error')
  await assertThrow(bob.request('test', { timeout: 100 }), NM_ERR_TIMEOUT)
  const [error] = await result
  assert.is(error.code, NM_ERR_MESSAGE.code)
})

test('send not implemented', async () => {
  const [alice] = create({
    send: undefined
  })

  await assertThrow(alice.request('test'), Error)
})

test('open option', async () => {
  const openFn = spy()

  const [alice] = create({
    open: openFn
  })

  await alice.open()
  assert.ok(openFn.called)

  const bob = new Nanomessage()
  await assertThrow(bob.send('data'), NM_ERR_NOT_OPEN)
})

test.run()
