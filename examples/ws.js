const WebSocket = require('ws')

const nanomessage = require('..')

// Server
const server = new WebSocket.Server({ port: 3000 })
server.on('connection', function connection (ws) {
  nanomessage({
    subscribe (ondata) {
      ws.on('message', ondata)
    },
    send (msg) {
      ws.send(msg)
    },
    onMessage (msg) {
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

Bob.open().catch(err => console.error(err))

;(async () => {
  console.log(await Bob.request('ping from Bob'))
})()
