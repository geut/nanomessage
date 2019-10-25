const net = require('net')

const { createFromSocket } = require('.')

function createServer (...args) {
  const _listener = args[args.length - 1]
  args[args.length - 1] = (socket) => {
    _listener(createFromSocket(socket))
  }

  return net.createServer(...args)
}

function createConnection (...args) {
  return createFromSocket(net.createConnection(...args))
}

module.exports = { createFromSocket, createServer, createConnection }
