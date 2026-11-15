import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ addresses: [] as Array<Array<{ address: string; family: number }>>, responses: [] as Response[] }))
vi.mock('node:dns', () => ({ lookup: (_host: string, _options: unknown, cb: (error: null, addresses: unknown) => void) => cb(null, state.addresses.shift() ?? []) }))
vi.mock('undici', async original => ({ ...await original<typeof import('undici')>(), fetch: async () => {
  const response = state.responses.shift()
  if (!response) throw Error('No upstream response')
  return response
} }))
import { publicLookup, publicFetch } from '../src/public-fetch.js'

it('rejects redirects from public hosts to internal and metadata endpoints', async () => {
  for (const target of ['http://127.0.0.1/', 'http://169.254.169.254/latest/', 'http://[::ffff:10.0.0.1]/']) {
    state.responses.push(new Response(null, { status: 302, headers: { location: target } }))
    await expect(publicFetch('https://images.example/photo.png')).rejects.toThrow(/Non-public/)
  }
})
it('validates every socket lookup including a changed DNS answer', async () => {
  state.addresses.push([{ address:'8.8.8.8',family:4 }], [{ address:'127.0.0.1',family:4 }])
  const lookup = () => new Promise<unknown>((resolve, reject) => publicLookup('images.example', { family: 0, hints:0 }, (error, address) => error ? reject(error) : resolve(address)))
  expect(await lookup()).toBe('8.8.8.8')
  await expect(lookup()).rejects.toThrow(/Non-public/)
})
it('rejects a mixed public/private DNS answer and oversized chunked responses', async () => {
  state.addresses.push([{ address:'8.8.8.8',family:4 }, { address:'10.0.0.1',family:4 }])
  await expect(new Promise((resolve, reject) => publicLookup('images.example', { family:0,hints:0 }, (error, address) => error ? reject(error) : resolve(address)))).rejects.toThrow(/Non-public/)
  state.responses.push(new Response(new Uint8Array(5 * 1024 * 1024 + 1)))
  await expect(publicFetch('https://images.example/photo.png')).rejects.toThrow(/too large/)
})
