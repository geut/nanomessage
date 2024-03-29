# nanomessage (aka nm)

![Test Status](https://github.com/geut/nanomessage/actions/workflows/test.yml/badge.svg)
[![Coverage](https://raw.githubusercontent.com/geut/nanomessage/gh-pages/badges/coverage.svg?raw=true)](https://geut.github.io/nanomessage/)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

> Simple module that helps you to build a `request-response` abstraction on top of any other solution (e.g. streams).

## <a name="install"></a> Install

```
$ npm install nanomessage
```

## <a name="usage"></a> Usage

```javascript
import WebSocket from 'ws'

import { Nanomessage } from 'nanomessage'

// server.js
const server = new WebSocket.Server({ port: 3000 })
server.on('connection', function connection (ws) {
  const nm = new Nanomessage({
    subscribe (ondata) {
      // Define how to read data
      ws.on('message', ondata)
    },
    send (msg) {
      // Define how to send data
      ws.send(msg)
    },
    onMessage (msg, opts) {
      // Process the new request and return a response
      console.log(msg)
      return 'pong from Alice'
    }
  })

  nm.open().catch(err => console.error(err))
})

// client.js
const ws = new WebSocket('ws://127.0.0.1:3000')
const Bob = new Nanomessage({
  async open() {
    if (ws.readyState === 0) {
      await new Promise(resolve => ws.once('open', resolve))
    }
  },
  subscribe (ondata) {
    ws.on('message', ondata)
  },
  send (msg) {
    ws.send(msg)
  }
})

;(async () => {
  await Bob.open()
  console.log(await Bob.request('ping from Bob'))
})()
```

## <a name="api"></a> API

#### `const nm = new Nanomessage(options)`

Create a new nanomessage.

Options include:

- `send: (chunk: Buffer, info: Object) => (Promise|undefined)`: Defines how to send the messages provide it by nanomessage to the low level solution.
- `subscribe: (onData: buf => Promise) => UnsubscribeFunction`: Defines how to read data from the low level solution.
- `onMessage: (msg: *, info: Object) => Promise<Response>`: Async handler to process the incoming requests.
- `open: () => Promise`: Defines a function to run before the nanomessage instance is opened.
- `close: () => Promise`: Defines a function to run after the nanomessage instance was close.
- `timeout: null`: Time to wait for the response of a request. Disabled by default.
- `concurrency: { incoming: 256, outgoing: 256 }`: Defines how many requests do you want to run (outgoing) and process (incoming) in concurrent.
- `valueEncoding: msgpackr`: Defines a [compatible codec](https://github.com/mafintosh/codecs) to encode/decode messages in nanomessage. By default use: [msgpackr](https://github.com/kriszyp/msgpackr)

`info` is an object with:

- `info.id: Number`: Incremental ID request.
- `info.data: *`: Plain data to send.
- `info.ephemeral: boolean`: It's true if the message is ephemeral.
- `info.response: boolean`: It's true if the message is a response.
- `info.responseData: *`: Plain data to response.

You can also extend from this prototype if you prefer:

```javascript
const { Nanomessage } = require('nanomessage')

class CustomNanomessage exports Nanomessage {
  constructor (...args) {
    super(...args)
  }

  _subscribe (onData) {}

  async _send (chunk, info) {}

  async _onMessage (msg, info) {}

  async _open() {
    await super._open()
  }

  async _close () {
    await super._close()
  }
}
```

#### `nm.requests: Array<Requests>`

Get the current list of requests (inflight and pending).

#### `nm.inflightRequests: Number`

Number of requests processing in the queue.

#### `nm.requestTimeout: Number`

Get the current request timeout.

#### `nm.concurrency: { incoming: Number, outgoing: Number }`

Get the current concurrency.

#### `nm.setRequestsTimeout(Number)`

Change the timeout for the future requests.

#### `nm.setConcurrency(Number | { incoming: Number, outgoing: Number })`

Update the concurrency number of operations for incoming and outgoing requests.

#### `nm.open() => Promise`

Opens nanomessage and start listening for incoming data.

#### `nm.close() => Promise`

Closes nanomessage and unsubscribe from incoming data.

#### `nm.request(data, [opts]) => Promise<Response>`

Send a request and wait for a response. `data` can be any serializable type supported by your codec.

- `opts.timeout: number`: Define a custom timeout for the current request.
- `opts.signal: AbortSignal`: Set an abort signal object to cancel the request.

#### `nm.send(data) => Promise<Response>`

Send a `ephemeral` message. `data` can be any serializable type supported by your codec.

#### `nm.processIncomingMessage(buf: Buffer) => Promise`

Access directly to the handler of incoming messages. It's recommended to use the subscription model instead.

#### `nm.setMessageHandler(handler) => Nanomessage`

Defines a request handler. It will override the old handler.

## <a name="issues"></a> Issues

:bug: If you found an issue we encourage you to report it on [github](https://github.com/geut/nanomessage/issues). Please specify your OS and the actions to reproduce it.

## <a name="contribute"></a> Contributing

:busts_in_silhouette: Ideas and contributions to the project are welcome. You must follow this [guideline](https://github.com/geut/nanomessage/blob/main/CONTRIBUTING.md).

## License

MIT © A [**GEUT**](http://geutstudio.com/) project
