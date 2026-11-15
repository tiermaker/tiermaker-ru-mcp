import { USER_AGENT } from "./config.js"
import { fail } from "./schema.js"
import type { Fetch } from "./catalog.js"

export type SourceId = "commons" | "wikidata" | "pokeapi" | "anilist" | "musicbrainz" | "caa" | "openlibrary"

const LABELS: Record<SourceId, string> = {
  commons: "Wikimedia Commons",
  wikidata: "Wikidata",
  pokeapi: "PokeAPI",
  anilist: "AniList",
  musicbrainz: "MusicBrainz",
  caa: "Cover Art Archive",
  openlibrary: "Open Library",
}

/** A source or an image host: image hosts are queued per host under `img:<host>`. */
type QueueKey = SourceId | `img:${string}`

export const REQUEST_TIMEOUT_MS = 8_000
/** After a connection failure a service is not asked again for this long, so a blocked host costs one timeout, not one per query. */
export const DOWN_COOLDOWN_MS = 2 * 60_000
/** Image hosts are not rate-limited APIs: HEAD checks of one host are spaced by a quarter of the source gap. */
const IMAGE_HOST_GAP_DIVISOR = 4
/** At most one request per second to each service (MusicBrainz and AniList ask for it). */
export const SOURCE_GAP_MS = 1_000
export const CACHE_TTL_MS = 10 * 60_000
const MAX_RETRIES = 3
const MAX_RETRY_WAIT_MS = 8_000

export type NetOptions = {
  fetch?: Fetch
  wait?: (ms: number) => Promise<void>
  now?: () => number
  gapMs?: number
}

export type CallOptions = {
  /** Shorter timeout for services that should degrade quickly. */
  timeoutMs?: number
  /** Retries on 429/5xx (default 3). */
  retries?: number
}

export type Net = {
  /** GET (or POST with `init.body`) JSON from `source`; `undefined` for 404 when `allow404`. */
  json(source: SourceId, url: string, init?: RequestInit, allow404?: boolean, options?: CallOptions): Promise<unknown>
  /** True when the url answers 200 with an `image/*` content type (following redirects); network errors count as "no". */
  isImage(url: string, options?: CallOptions & { source?: SourceId }): Promise<boolean>
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/** One client per server: a request queue per source, retries on 429/5xx, and a 10-minute in-memory cache. */
export function createNet(options: NetOptions = {}): Net {
  const fetchImpl = options.fetch ?? fetch
  const wait = options.wait ?? sleep
  const now = options.now ?? Date.now
  const gap = options.gapMs ?? SOURCE_GAP_MS
  const chains = new Map<QueueKey, Promise<unknown>>()
  const pending = new Map<QueueKey, number>()
  let cacheBytes = 0
  const lastStart = new Map<QueueKey, number>()
  const downUntil = new Map<QueueKey, number>()
  const cache = new Map<string, { at: number; value: unknown; bytes: number }>()

  /** Jobs of one source run one at a time, at least `gap` ms apart; sources do not wait for each other. */
  function queued<T>(source: QueueKey, job: () => Promise<T>, spacing = gap): Promise<T> {
    if ((pending.get(source) ?? 0) >= 32) return Promise.reject(new Error("Image service busy; try again shortly."))
    pending.set(source, (pending.get(source) ?? 0) + 1)
    const run = (chains.get(source) ?? Promise.resolve()).then(async () => {
      const pause = (lastStart.get(source) ?? -Infinity) + spacing - now()
      if (pause > 0) await wait(pause)
      lastStart.set(source, now())
      return job()
    })
    const settled = run.catch(() => undefined)
    chains.set(source, settled)
    void settled.then(() => {
      pending.set(source, (pending.get(source) ?? 1) - 1)
      if (pending.get(source) === 0) pending.delete(source)
      if (chains.get(source) === settled && source.startsWith("img:")) {
        chains.delete(source); lastStart.delete(source); downUntil.delete(source)
      }
    })
    return run
  }

  const label = (key: QueueKey) => (key.startsWith("img:") ? key.slice(4) : LABELS[key as SourceId])

  async function request(source: QueueKey, url: string, init: RequestInit, accept: string, options: CallOptions = {}): Promise<Response> {
    const maxRetries = options.retries ?? MAX_RETRIES
    const unreachable = () => fail(`Could not reach ${label(source)} for the image search. Check the connection or continue without images.`)
    for (let attempt = 0; ; attempt++) {
      if ((downUntil.get(source) ?? 0) > now()) return unreachable()
      let response: Response
      try {
        response = await queued(source, () =>
          fetchImpl(url, {
            ...init,
            headers: { Accept: accept, "User-Agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
          }),
          source.startsWith("img:") ? Math.floor(gap / IMAGE_HOST_GAP_DIVISOR) : gap,
        )
      } catch {
        downUntil.set(source, now() + DOWN_COOLDOWN_MS)
        return unreachable()
      }
      if ((response.status !== 429 && response.status < 500) || attempt >= maxRetries) return response
      void response.body?.cancel()
      const asked = Number(response.headers.get("retry-after"))
      await wait(Math.min(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1000 * (attempt + 1), MAX_RETRY_WAIT_MS))
    }
  }

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value as T
    const value = await load()
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? "")
    if (bytes > 1024 * 1024) return value
    const old = cache.get(key)
    if (old) { cacheBytes -= old.bytes; cache.delete(key) }
    while (cache.size >= 128 || cacheBytes + bytes > 16 * 1024 * 1024) {
      const first = cache.keys().next().value!
      cacheBytes -= cache.get(first)!.bytes
      cache.delete(first)
    }
    cache.set(key, { at: now(), value, bytes })
    cacheBytes += bytes
    return value
  }

  return {
    json: (source, url, init = {}, allow404 = false, options) =>
      cached(`${init.method ?? "GET"} ${url} ${String(init.body ?? "")}`, async () => {
        const response = await request(source, url, init, "application/json", options)
        if (allow404 && response.status === 404) return undefined
        if (!response.ok) {
          fail(`${label(source)} answered with HTTP ${response.status}${response.status === 429 ? " (too many requests)" : ""}. Continue without images or try again later.`)
        }
        try {
          return (await response.json()) as unknown
        } catch {
          return fail(`${label(source)} returned an unreadable response.`)
        }
      }),
    isImage: (url, options = {}) =>
      cached(`IMG ${url}`, async () => {
        const key: QueueKey = options.source ?? `img:${new URL(url).host}`
        try {
          let response = await request(key, url, { method: "HEAD" }, "image/*", options)
          // some hosts refuse HEAD: ask for the headers with GET and drop the body
          if ([403, 405, 501].includes(response.status)) response = await request(key, url, { method: "GET", headers: { Range: "bytes=0-0" } }, "image/*", options)
          void response.body?.cancel()
          return (response.status === 200 || response.status === 206) && (response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")
        } catch {
          return false
        }
      }),
  }
}
