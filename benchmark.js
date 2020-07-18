const bench = require('nanobench')
const create = require('./tests/create')

bench('execute 10000 requests x 2 peers', async function (b) {
  const [alice, bob] = create({
    concurrency: 100,
    onMessage: () => 'pong'
  }, {
    concurrency: 100,
    onMessage: () => 'pong'
  })
  await alice.open()
  await bob.open()

  b.start()

  await Promise.all([
    Promise.all([...Array(10000).keys()].map(i => {
      return alice.request('ping')
    })),
    Promise.all([...Array(10000).keys()].map(i => {
      return bob.request('ping')
    }))
  ])

  b.end()
})

bench('execute 10000 ephemeral messages x 2 peers', async function (b) {
  let aliceTotal = 0
  let bobTotal = 0
  let done = null
  const waitFor = new Promise(resolve => {
    done = resolve
  })
  const [alice, bob] = create({
    onMessage () {
      aliceTotal++
      if (aliceTotal === 10000 && bobTotal === 10000) done()
    }
  }, {
    onMessage () {
      bobTotal++
      if (aliceTotal === 10000 && bobTotal === 10000) done()
    }
  })
  await alice.open()
  await bob.open()

  b.start()

  await Promise.all([
    Promise.all([...Array(10000).keys()].map(i => {
      return alice.send('test')
    })),
    Promise.all([...Array(10000).keys()].map(i => {
      return bob.send('test')
    }))
  ])
  await waitFor
  b.end()
})
