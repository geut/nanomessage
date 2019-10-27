const through = require('through2')
const duplexify = require('duplexify')

const { createFromSocket } = require('..')
const t1 = through()
const t2 = through()

// Alice
createFromSocket(duplexify(t1, t2), {
  onmessage: data => {
    console.log(data)
    return 'pong from alice!'
  }
})

// Bob
const bob = createFromSocket(duplexify(t2, t1))

;(async () => {
  console.log(await bob.request('ping from bob!'))
})()
