# nanomessage (aka nm)

[![Build Status](https://travis-ci.com/geut/nanomessage.svg?branch=master)](https://travis-ci.com/geut/nanomessage)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

> Simple module that helps you to build a `request-response` abstraction on top of any other solution (e.g. streams).

## <a name="install"></a> Install

```
$ npm install nanomessage
```

## <a name="usage"></a> Usage

### WebSocket
```javascript
const WebSocket = require('ws')

const nanomessage = require('..')

// Server
const server = new WebSocket.Server({ port: 3000 })
server.on('connection', function connection (ws) {
  nanomessage({
    subscribe (ondata) {
      // Define how to read data
      ws.on('message', ondata)
    },
    send (msg) {
      // Define how to send data
      ws.send(msg)
    },
    onMessage (msg) {
      // Process the new request and return a response
      console.log(msg)
      return 'pong from Alice'
    }
  }).open().catch(err => console.error(err))
})

// Client
const ws = new WebSocket('ws://127.0.0.1:3000')
const Bob = nanomessage({
  subscribe (ondata) {
    ws.on('message', ondata)
  },
  async send (msg) {
    if (ws.readyState === 0) {
      await new Promise(resolve => ws.once('open', resolve))
    }
    ws.send(msg)
  }
})

;(async () => {
  await Bob.open()
  console.log(await Bob.request('ping from Bob'))
})()
```

### net + createFromStream helper
```javascript
const net = require('net')

const { createFromStream } = require('..')

const Alice = net.createServer(socket => {
  createFromStream(socket, {
    onMessage (msg) {
      console.log(msg)
      return 'pong from Alice'
    }
  })
})

Alice.listen(3000)

const Bob = createFromStream(net.createConnection(3000))

;(async () => {
  console.log(await Bob.request('ping from Bob'))
})()
```

## <a name="api"></a> API

#### `const nm = nanomessage(options)`

Create a new nanomessage.

Options include:

- `send: (chunk: Buffer) -> Promise<*>`: Defines how to send the messages provide it by nanomessage to the low level solution.
- `subscribe: (onData: function) -> UnsubscribeFunction`: Defines how to read data from the low level solution.
- `onMessage: (msg) -> Promise<Response>`: Async handler to process the incoming requests.
- `close: () -> Promise<*>`: Defines a function to run after the nanomessage instance was close.
- `timeout: 10 * 1000`: Time to wait for the response of a request.
- `concurrency: Infinity`: Defines how many requests do you want to run in concurrent.
- `codec: JSON`: Defines a [compatible codec](https://github.com/mafintosh/codecs) to encode/decode messages in nanomessage.

You can also extend from this prototype if you prefer:

```javascript
const { Nanomessage } = require('nanomessage')

class CustomNanomessage exports Nanomessage {
  constructor (...args) {
    super(...args)
  }

  _subscribe () {}

  async _send (chunk) {}

  async _onMessage (msg) {}

  async _close () {}
}
```

#### `nm.open() -> Promise`

Opens nanomessage and start listening for incoming data.

#### `nm.close() -> Promise`

Closes nanomessage and unsubscribe from incoming data.

#### `nm.request(data) -> Promise<Response>`

Send a request and wait for a response. `data` can be any serializable type supported by your codec.

#### `nm.send(data) -> Promise<Response>`

Send a `ephemeral` message. `data` can be any serializable type supported by your codec.

#### `nm.setMessageHandler(handler) -> Nanomessage`

Defines a request handler. It will override the old handler.

#### `nm.close() -> Promise<*>`

Close the nanomessage instance.

## <a name="issues"></a> Issues

:bug: If you found an issue we encourage you to report it on [github](https://github.com/geut/nanomessage/issues). Please specify your OS and the actions to reproduce it.

## <a name="contribute"></a> Contributing

:busts_in_silhouette: Ideas and contributions to the project are welcome. You must follow this [guideline](https://github.com/geut/nanomessage/blob/master/CONTRIBUTING.md).

## License

MIT © A [**GEUT**](http://geutstudio.com/) project
