import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { SqliteStore } from '../src/storage.js'
import { addItems } from '../src/board.js'
import { isPublicAddress, publicFetch } from '../src/public-fetch.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
it('persists edits across restart and expires seven days after the last change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-storage-')); dirs.push(dir)
  let now = 1000
  let store = new SqliteStore(join(dir, 'boards.sqlite'), () => now)
  const board = store.create('Кириллица')
  store.save(board)
  expect(board.id).toMatch(/^[a-f0-9]{64}$/)
  now += 6 * 86400000
  store.transaction(() => addItems(store.get(board.id), [{ label: 'Чай' }]))
  store.close()
  store = new SqliteStore(join(dir, 'boards.sqlite'), () => now)
  expect(store.get(board.id).items[0]?.label).toBe('Чай')
  expect(() => store.get('0'.repeat(64))).toThrow(/not found|expired/)
  now += 6 * 86400000
  expect(store.get(board.id).title).toBe('Кириллица')
  now += 86400001
  expect(() => store.get(board.id)).toThrow(/not found|expired/)
  store.close()
})
it('rolls back failed mutations and expires downloaded artifacts independently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-storage-')); dirs.push(dir)
  let now = 0
  const store = new SqliteStore(join(dir, 'boards.sqlite'), () => now)
  const board = store.create('Test'); store.save(board)
  expect(() => store.transaction(() => { addItems(store.get(board.id), [{ label: 'lost' }]); throw Error('stop') })).toThrow('stop')
  expect(store.get(board.id).items).toEqual([])
  const token = store.artifact(board.id, Buffer.from('json'), 'application/json')
  expect(store.download(token)?.data.toString()).toBe('json')
  now += 86400001
  expect(store.download(token)).toBeUndefined()
  expect(store.get(board.id).title).toBe('Test')
  store.close()
})
it.each(['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','100.64.0.1','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1'])('blocks non-public address %s', (address) => expect(isPublicAddress(address)).toBe(false))
it('permits public unicast and rejects local URLs before connecting', async () => {
  expect(isPublicAddress('8.8.8.8')).toBe(true)
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  await expect(publicFetch('http://127.0.0.1/')).rejects.toThrow()
  await expect(publicFetch('http://[::1]/')).rejects.toThrow()
})
it('rejects a highly compressed image with unsafe pixel dimensions before rendering', async () => {
  const { fetchImage } = await import('../src/render.js')
  const { pngBytes } = await import('./helpers.js')
  const data = pngBytes()
  data.writeUInt32BE(100000, 16)
  data.writeUInt32BE(100000, 20)
  const upstream = (async () => new Response(data, { headers: { 'content-type': 'image/png' } })) as typeof fetch
  expect(await fetchImage('https://images.example/bomb.png', upstream)).toBeUndefined()
})
