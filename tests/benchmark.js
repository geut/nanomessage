import { Bench } from 'tinybench'

import create from './create.js'
import { Nanomessage, createPackr } from '../src/index.js'

const context = {
  basic: async () => {
    const [alice, bob] = create({
      onMessage: () => ({ value: 'pong' })
    }, {
      onMessage: () => ({ value: 'pong' })
    })
    await alice.open()
    await bob.open()
    return { alice, bob }
  },
  sharedStructures: async () => {
    const packr = createPackr({
      structures: []
    })

    const valueEncoding = {
      encode: (data) => packr.pack(data),
      decode: (data) => packr.unpack(data)
    }

    const [alice, bob] = create({
      valueEncoding,
      onMessage: () => ({ value: 'pong' })
    }, {
      valueEncoding,
      onMessage: () => ({ value: 'pong' })
    })
    await alice.open()
    await bob.open()
    return { alice, bob }
  }
}

const bench = new Bench({
  time: 0,
  iterations: 10_000,
  setup: async (task) => {
    if (task.name.includes('sharedStructures')) {
      task.context = await context.sharedStructures()
    } else {
      task.context = await context.basic()
    }
  }
})

bench
  .add('execute 10000 requests x 2 peers', async function () {
    const { alice } = this.context
    const res = await alice.request({ value: 'ping' })
    if (res.value !== 'pong') throw new Error('wrong')
  })
  .add('execute 10000 ephemeral messages x 2 peers', async function () {
    const { alice, bob } = this.context
    await alice.send('test')
    await Nanomessage.once(bob, 'message')
  })
  .add('execute 10000 requests x 2 peers using sharedStructures', async function () {
    const { alice } = this.context
    const res = await alice.request({ value: 'ping' })
    if (res.value !== 'pong') throw new Error('wrong')
  })

await bench.run()

console.table(
  bench.tasks.map(({ name, result }) => (result
    ? ({
        'Task Name': name,
        'ops/sec': parseInt(result.hz, 10),
        'Total Time (ms)': Math.round(result.totalTime),
        'Average Time (ns)': Math.round(result.mean * 1000 * 1000),
        Margin: `\xb1${result.rme.toFixed(2)}%`,
        Samples: result.samples.length
      })
    : null))
)
