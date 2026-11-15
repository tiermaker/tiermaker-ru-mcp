import { BoardError } from './schema.js'

/** Bounded shared process queue; a rejected job never enters the queue. */
export class WorkQueue {
  private active = 0
  private waiting: Array<() => void> = []
  constructor(private concurrency: number, private capacity: number) {}
  get depth(): number { return this.waiting.length }
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.capacity) throw new BoardError('Server busy. Try again shortly; your board is saved.')
      await new Promise<void>(resolve => this.waiting.push(resolve))
    } else this.active++
    try { return await job() }
    finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }
}
