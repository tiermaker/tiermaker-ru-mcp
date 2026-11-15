import { createServer as createHttpServer } from 'node:http'
import { mkdirSync, statfsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './tools.js'
import { SqliteStore } from './storage.js'
import { publicFetch } from './public-fetch.js'
import { createImageSearch } from './images.js'
import { WorkQueue } from './limits.js'
import { renderBoardPng } from './render.js'
import { resolveBaseUrl, resolveShortLinks } from './config.js'
import type { Fetch } from './catalog.js'

export type HttpOptions = { dbPath: string; publicUrl: string; port?: number; host?: string; baseUrl?: string; fetch?: Fetch; requestsPerMinute?: number }

export async function startHttp(options: HttpOptions) {
  const origin = new URL(options.publicUrl)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw Error('PUBLIC_URL must be an HTTPS origin')
  mkdirSync(dirname(options.dbPath), { recursive: true })
  const store = new SqliteStore(options.dbPath)
  const network = options.fetch ?? publicFetch
  const imageSearch = createImageSearch({ fetch: network })
  const renders = new WorkQueue(1, 3)
  const requests = new WorkQueue(8, 0)
  const toolMetrics = new Map<string, { count: number; errors: number; duration: number }>()
  let window = Date.now(), count = 0, failures = 0, completed = 0, durationMs = 0
  const cleanup = setInterval(() => { try { store.cleanup() } catch { failures++ } }, 60000)
  cleanup.unref()
  const http = createHttpServer(async (req, res) => {
    const send = (code: number, message: string) => { res.writeHead(code, { 'Content-Type':'text/plain', 'Cache-Control':'no-store' }); res.end(message) }
    // Never use X-Forwarded-Host or client supplied forwarding headers for trust decisions.
    if (![origin.host, `127.0.0.1:${(http.address() as { port: number } | null)?.port}`, `localhost:${(http.address() as { port: number } | null)?.port}`].includes(req.headers.host ?? '')) { send(403, 'Invalid host'); return }
    if (req.headers.origin && req.headers.origin !== origin.origin) { send(403, 'Invalid origin'); return }
    res.setHeader('Referrer-Policy','no-referrer')
    res.setHeader('X-Content-Type-Options','nosniff')
    const path = (req.url ?? '').split('?')[0]!
    const pages: Record<string, string> = {
      '/docs': 'TierMaker.ru creates tier lists from conversation, renders PNG and exports TierListImport v1 JSON. Connect using https://mcp.tiermaker.ru/mcp with Streamable HTTP and no authentication. Source and instructions: https://github.com/tiermaker/tiermaker-ru-mcp . Independent of tiermaker.com. No access to saved account work. Board IDs and download URLs grant access: keep them private.',
      '/privacy': 'TierMaker.ru MCP privacy. No account or OAuth. Board text, image URLs and placement are stored on this server for seven days after the last edit. Downloaded PNG/JSON expires after 24 hours and no later than its board. Anyone possessing a board token or result URL can access that result. Calling get_editor_link sends the board to tiermaker.ru for a separate editor draft retained 180 days; if unavailable a #tm= URL contains the board instead. Image queries go to the selected image services; rendering fetches image URLs. These services receive queries, URLs and server IP. Search caches last up to ten minutes. The operator does not log tokens, board content or full access URLs; aggregate metrics contain tool names and timings. Infrastructure backups may retain a copy for the operator backup retention period. Do not submit sensitive data. Client providers have their own privacy policies. Support: https://github.com/tiermaker/tiermaker-ru-mcp/issues .',
      '/support': 'TierMaker.ru MCP support: https://github.com/tiermaker/tiermaker-ru-mcp/issues . Do not include board IDs, access links or private data in a public issue. For vulnerabilities use a private GitHub security advisory.',
      '/terms': 'TierMaker.ru is independent of tiermaker.com. This service creates anonymous tier lists; it does not access account work or sell products. Use only images you are entitled to use, and keep the source attribution returned by search_images. Third-party images retain their original rights. Software is provided under the MIT license without warranty: https://github.com/tiermaker/tiermaker-ru-mcp/blob/main/LICENSE .',
    }
    if (req.method === 'GET' && pages[path]) { send(200, pages[path]); return }
    if (path === '/healthz' && req.method === 'GET') { send(200, 'ok'); return }
    if (path === '/metrics' && req.method === 'GET') {
      const fs = statfsSync(dirname(options.dbPath))
      send(200, `tiermaker_requests_total ${completed}\ntiermaker_errors_total ${failures}\ntiermaker_request_duration_ms_total ${durationMs}\ntiermaker_render_queue ${renders.depth}\ntiermaker_disk_available_bytes ${fs.bavail * fs.bsize}\n${[...toolMetrics].map(([name, m]) => `tiermaker_tool_calls_total{tool="${name}"} ${m.count}\ntiermaker_tool_errors_total{tool="${name}"} ${m.errors}\ntiermaker_tool_duration_ms_total{tool="${name}"} ${m.duration}\n`).join('')}`); return
    }
    if (Date.now() - window >= 60000) { window = Date.now(); count = 0 }
    if (++count > (options.requestsPerMinute ?? 120)) { res.setHeader('Retry-After', '60'); send(429, 'Rate limit reached. Your board is saved.'); return }
    if (path.startsWith('/files/') && req.method === 'GET') {
      const file = store.download(path.slice('/files/'.length))
      if (!file) { send(404, 'File not found or expired'); return }
      res.writeHead(200, { 'Content-Type':file.mime, 'Content-Disposition':`attachment; filename="tierlist.${file.mime === 'image/png' ? 'png' : 'tierlist.json'}"`, 'Content-Length':file.data.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' }); res.end(file.data); return
    }
    if (path !== '/mcp') { send(404, 'Not found'); return }
    if (req.method !== 'POST') { res.setHeader('Allow','POST'); send(405, 'Use a Streamable HTTP POST'); return }
    const started = Date.now()
    try {
      await requests.run(async () => {
        let bytes = 0
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 1024 * 1024) { send(413, 'Request too large'); return }
          chunks.push(chunk)
        }
        let body: unknown
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { send(400, 'Invalid JSON'); return }
        if (!body || typeof body !== "object" || Array.isArray(body)) { send(400, "One JSON-RPC message is required; batches are unsupported."); return }
        const server = createServer({
          baseUrl: options.baseUrl ?? resolveBaseUrl(), fetch: network, store,
          shortLinks: resolveShortLinks(), imageSearch,
          onTool: (name, error, duration) => {
            const metric = toolMetrics.get(name) ?? { count: 0, errors: 0, duration: 0 }
            metric.count++; metric.errors += Number(error); metric.duration += duration; toolMetrics.set(name, metric)
          },
          remote: {
            publish: (id, data, mime) => `${origin.origin}/files/${store.artifact(id, data, mime)}`,
            render: board => renders.run(() => renderBoardPng(board, network)),
          },
        })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        try {
          await server.connect(transport)
          await transport.handleRequest(req, res, body)
        } finally { await server.close() }
      })
      completed++
    } catch { failures++; if (!res.headersSent) send(503, 'Server busy. Try again shortly; your board is saved.') }
    finally { durationMs += Date.now() - started }
  })
  http.requestTimeout = 15000
  http.headersTimeout = 10000
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(options.port ?? 3001, options.host ?? '127.0.0.1', resolve) })
  return {
    port: (http.address() as { port: number }).port,
    close: async () => { clearInterval(cleanup); await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); store.close() },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startHttp({ dbPath: process.env.DB_PATH ?? '/data/boards.sqlite', publicUrl: process.env.PUBLIC_URL ?? 'https://mcp.tiermaker.ru', host: '0.0.0.0', port: Number(process.env.PORT ?? 3001) }).then(app => {
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close().then(() => process.exit(0)) })
  }).catch(() => { console.error('HTTP server startup failed; check configuration and database permissions.'); process.exit(1) })
}
