import { lookup } from 'node:dns'
import { Agent, fetch as undiciFetch } from 'undici'
import ipaddr from 'ipaddr.js'
import { WorkQueue } from './limits.js'
import type { Fetch } from './catalog.js'

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address)
    return parsed.range() === 'unicast'
  } catch { return false }
}

// The same guarded lookup is passed directly to every socket opened by undici.
export const publicLookup: import('node:net').LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) { callback(error, '', 4); return }
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new Error('Non-public image host blocked'), '', 4); return
    }
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}
const dispatcher = new Agent({ connections: 4, pipelining: 1, connect: { lookup: publicLookup } })

/** Every redirect and every actual socket resolution is checked. No proxy environment is inherited. */
const downloads = new WorkQueue(4, 32)
export const publicFetch: Fetch = async (input, init) => downloads.run(async () => {
  const signal = init?.signal ?? AbortSignal.timeout(8000)
  let url = new URL(String(input))
  for (let hop = 0; hop <= 5; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw Error('Unsupported image URL')
    if (ipaddr.isValid(host) && !isPublicAddress(host)) throw Error('Non-public image host blocked')
    const response = await undiciFetch(url, { ...init, signal, redirect: 'manual', dispatcher } as Parameters<typeof undiciFetch>[1])
    if (![301,302,303,307,308].includes(response.status)) {
      if (init?.method === 'HEAD' || [204,205,304].includes(response.status)) return new Response(null, { status: response.status, headers: Object.fromEntries(response.headers) })
      const chunks: Uint8Array[] = []
      let size = 0
      if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024) { await response.body?.cancel(); throw Error('Remote response too large') }
      if (response.body) for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > 5 * 1024 * 1024) throw Error('Remote response too large')
        chunks.push(chunk)
      }
      const headers = new Headers(Object.fromEntries(response.headers))
      headers.delete('content-encoding'); headers.delete('content-length')
      return new Response(Buffer.concat(chunks), { status: response.status, headers })
    }
    await response.body?.cancel()
    const location = response.headers.get('location')
    if (!location || hop === 5) throw Error('Invalid image redirect')
    url = new URL(location, url)
  }
  throw Error('Too many image redirects')
})
