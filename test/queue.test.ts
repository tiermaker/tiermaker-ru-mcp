import { expect, it } from 'vitest'
import { WorkQueue } from '../src/limits.js'

it('rejects overflow and runs queued work after a failing render', async () => {
  const queue = new WorkQueue(1, 1)
  let release!: () => void
  const first = queue.run(async () => { await new Promise<void>(resolve => { release = resolve }); throw Error('bad image') })
  const waiting = queue.run(async () => 'saved board')
  await expect(queue.run(async () => 'overflow')).rejects.toThrow(/busy/)
  expect(queue.depth).toBe(1)
  release()
  await expect(first).rejects.toThrow('bad image')
  expect(await waiting).toBe('saved board')
  expect(queue.depth).toBe(0)
})
