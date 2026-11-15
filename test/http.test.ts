import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, it } from 'vitest'
import { startHttp } from '../src/http.js'
import { mockFetch } from './helpers.js'

it('serves stateless tools, persistent boards and downloads without server paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-http-'))
  let app = await startHttp({ dbPath: join(dir, 'db.sqlite'), publicUrl: 'https://mcp.tiermaker.ru', port: 0, baseUrl: 'https://tiermaker.example', fetch: mockFetch() })
  const connect = async () => {
    const client = new Client({ name: 'acceptance', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`)))
    return client
  }
  let client = await connect()
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    expect(result.isError).not.toBe(true)
    return result.structuredContent as Record<string, unknown>
  }
  try {
    const tools = (await client.listTools()).tools
    for (const tool of tools) { expect(tool.title).toBeTruthy(); expect(tool.annotations?.readOnlyHint).toBeTypeOf('boolean') }
    expect(JSON.stringify(tools.filter(t => ['render_image','export_json'].includes(t.name)))).not.toContain('output_path')
    const { board_id } = await call('create_tierlist', { title: 'Чай / Tea' })
    await Promise.all([call('add_items', { board_id, items: [{ label: 'Чай' }] }), call('add_items', { board_id, items: [{ label: 'Coffee' }] })])
    await call('place_items', { board_id, placements: { S: ['i1'], A: ['i2'] } })
    await client.close(); await app.close()
    app = await startHttp({ dbPath: join(dir, 'db.sqlite'), publicUrl: 'https://mcp.tiermaker.ru', port: 0, baseUrl: 'https://tiermaker.example', fetch: mockFetch() })
    client = await connect()
    expect((await call('get_tierlist', { board_id })).item_count).toBe(2)
    const exported = await call('export_json', { board_id })
    expect(JSON.stringify(exported)).not.toContain('/app')
    const download = async (url: unknown) => fetch(`http://127.0.0.1:${app.port}${new URL(String(url)).pathname}`)
    const response = await download(exported.download_url)
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(await response.json()).toMatchObject({ version: 1, title: 'Чай / Tea', placements: { S: ['i1'], A: ['i2'] } })
    const png = await call('render_image', { board_id })
    expect((await download(png.download_url)).headers.get('content-type')).toBe('image/png')
    const denied = await client.callTool({ name: 'get_tierlist', arguments: { board_id: '0'.repeat(64) } })
    expect(denied.isError).toBe(true)
    const invalid = await client.callTool({ name: 'export_json', arguments: { board_id, output_path: '/tmp/forbidden.json' } })
    expect(invalid.isError).toBe(true)
    expect((await fetch(`http://127.0.0.1:${app.port}/mcp`, { method:'POST', headers:{ Origin:'https://evil.example','Content-Type':'application/json' }, body:'{}' })).status).toBe(403)
  } finally { await client.close(); await app.close(); rmSync(dir, { recursive: true, force: true }) }
}, 30000)
it('rejects batches before any tool executes and applies process request rate limits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-limits-'))
  const app = await startHttp({ dbPath: join(dir,'db.sqlite'), publicUrl:'https://mcp.tiermaker.ru', port:0, requestsPerMinute:2 })
  const url = `http://127.0.0.1:${app.port}`
  try {
    const batch = Array.from({ length:100 }, (_,id) => ({ jsonrpc:'2.0', id, method:'tools/call', params:{ name:'create_tierlist', arguments:{ title:'batch' } } }))
    expect((await fetch(`${url}/mcp`, { method:'POST', headers:{ 'Content-Type':'application/json',Accept:'application/json, text/event-stream' }, body:JSON.stringify(batch) })).status).toBe(400)
    const metrics = await (await fetch(`${url}/metrics`)).text()
    expect(metrics).not.toContain('tool="create_tierlist"')
    await fetch(`${url}/files/invalid`)
    expect((await fetch(`${url}/files/invalid`)).status).toBe(429)
    expect((await fetch(`${url}/healthz`)).status).toBe(200)
  } finally { await app.close(); rmSync(dir,{ recursive:true,force:true }) }
})
it('creates from templates and returns downloadable JSON when a full editor link is too large', async () => {
  const { randomBytes } = await import('node:crypto')
  const dir = mkdtempSync(join(tmpdir(), 'tm-export-'))
  const app = await startHttp({ dbPath:join(dir,'db.sqlite'), publicUrl:'https://mcp.tiermaker.ru', port:0, baseUrl:'https://tiermaker.example', fetch:mockFetch() })
  const client = new Client({ name:'export-test',version:'1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`)))
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments:args })
      expect(result.isError).not.toBe(true)
      return result.structuredContent as Record<string,unknown>
    }
    const template = await call('create_tierlist',{ title:'Fruit',template_slug:'fruits' })
    expect((await call('get_tierlist',{ board_id:template.board_id })).item_count).toBe(3)
    const link = await call('get_editor_link',{ board_id:template.board_id })
    expect(link.url).toMatch(/\/create#tm=/)
    expect(link.note).toMatch(/Short link unavailable/)
    const { board_id } = await call('create_tierlist',{ title:'Large' })
    await call('add_items',{ board_id, items:Array.from({ length:100 },(_,index) => ({ label:`Item ${index}`, image_url:`https://images.example/${randomBytes(400).toString('hex')}.png` })) })
    const exported = await call('get_editor_link',{ board_id })
    expect(exported.url).toBeUndefined()
    expect(exported.download_url).toMatch(/^https:\/\/mcp.tiermaker.ru\/files\/[a-f0-9]{64}$/)
    expect(exported.instructions).toContain('Импорт из файла')
    const response = await fetch(`http://127.0.0.1:${app.port}${new URL(String(exported.download_url)).pathname}`)
    const payload = await response.json() as { items: unknown[] }
    expect(payload.items).toHaveLength(100)
    expect((await fetch(`http://127.0.0.1:${app.port}/mcp`,{ method:'POST',body:'{' })).status).toBe(400)
  } finally { await client.close(); await app.close(); rmSync(dir,{ recursive:true,force:true }) }
})
