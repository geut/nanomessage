const net = require('./net')

net.createServer(ar => {
  ar.setMessageHandler(data => {
    return 'pong from alice!'
  })
}).listen(3000)
const bob = net.createConnection(3000)

;(async () => {
  console.log(await bob.request('ping from bob!'))
})()
