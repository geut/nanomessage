const net = require('net')

const { createFromSocket } = require('..')

const Alice = net.createServer(socket => {
  createFromSocket(socket, {
    onrequest (msg) {
      console.log(msg)
      return 'pong from Alice'
    }
  })
})

Alice.listen(3000)

const Bob = createFromSocket(net.createConnection(3000))

;(async () => {
  console.log(await Bob.request('ping from Bob'))
})()
