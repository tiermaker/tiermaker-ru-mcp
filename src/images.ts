import { fail } from "./schema.js"
import { createNet, type Net, type NetOptions } from "./image-net.js"

const COMMONS_API = "https://commons.wikimedia.org/w/api.php"
const WIKIDATA_API = "https://www.wikidata.org/w/api.php"
const POKEAPI = "https://pokeapi.co/api/v2/pokemon"
const ANILIST_API = "https://graphql.anilist.co"
const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2/release-group/"
const COVER_ART = "https://coverartarchive.org/release-group"
const OPENLIBRARY_API = "https://openlibrary.org/search.json"
const OPENLIBRARY_COVERS = "https://covers.openlibrary.org/b/id"

/** Commons serves thumbnails in fixed steps (…, 330, 500, 960, …): 512 is rounded up to 960, so 500 is requested. */
const THUMB_WIDTH = 500
export const MAX_THUMB_WIDTH = 512
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"])
const COPYRIGHTED = "copyrighted, used by reference"

export const MAX_IMAGE_RESULTS = 10
export const IMAGE_SOURCES = ["auto", "commons", "wikidata", "pokeapi", "anilist", "coverart", "openlibrary"] as const
export type ImageSource = (typeof IMAGE_SOURCES)[number]
export const IMAGE_TOPICS = ["general", "pokemon", "anime", "manga", "character", "music", "book"] as const
export type ImageTopic = (typeof IMAGE_TOPICS)[number]

export type ImageResult = {
  url: string
  title: string
  /** Service the picture came from (commons, wikidata, pokeapi, anilist, coverart, openlibrary). */
  source: string
  /** Free license of the file; set for Commons/Wikidata pictures. */
  license?: string
  /** Set instead of `license` for artwork that is not freely licensed. */
  rights?: string
  /** Who to credit: the author for free files, the service for copyrighted artwork. Always present. */
  attribution: string
  page_url: string
}

export type ImageSearch = { images: ImageResult[]; note?: string }
export type ImageSearcher = (query: string, options?: { source?: ImageSource; topic?: ImageTopic; limit?: number }) => Promise<ImageSearch>

type Meta = Record<string, { value?: unknown } | undefined>
type Page = {
  title?: string
  index?: number
  imageinfo?: Array<{ thumburl?: string; thumbwidth?: number; url?: string; mime?: string; descriptionurl?: string; extmetadata?: Meta }>
}
type Found = Omit<ImageResult, "source">

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()

const meta = (data: Meta | undefined, key: string): string => {
  const value = data?.[key]?.value
  return typeof value === "string" ? stripTags(value) : ""
}

function captionOf(title: string): string {
  return title.replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim()
}

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")
const httpsUrl = (value: unknown): string => {
  const url = text(value)
  return /^https:\/\//.test(url) ? url : ""
}

/** A Commons page as a result: only real thumbnails (≤ 512 px) of jpeg/png/webp; SVG logos count through their png thumbnail. */
function commonsResult(page: Page): Found | undefined {
  const info = page.imageinfo?.[0]
  const url = info?.thumburl
  if (!info || !url || !/^https:\/\//.test(url)) return undefined
  const mime = (info.mime ?? "").toLowerCase()
  const svgThumb = mime === "image/svg+xml" && /\.png$/i.test(new URL(url).pathname)
  if (!ALLOWED_MIME.has(mime) && !svgThumb) return undefined
  // the width in the url (".../500px-name.jpg") and the reported width must both be within the limit
  const stepped = /\/(\d+)px-[^/]*$/.exec(new URL(url).pathname)?.[1]
  if ((stepped ? Number(stepped) : Infinity) > MAX_THUMB_WIDTH || (info.thumbwidth ?? Infinity) > MAX_THUMB_WIDTH) return undefined
  const author = meta(info.extmetadata, "Artist")
  return {
    url,
    title: captionOf(page.title ?? ""),
    license: meta(info.extmetadata, "LicenseShortName") || "unknown",
    attribution: author || "Unknown author, via Wikimedia Commons",
    page_url: info.descriptionurl ?? "",
  }
}

const commonsParams = (extra: Record<string, string>) =>
  new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    ...extra,
  })

type Context = { net: Net; query: string; count: number; topic: ImageTopic | undefined }
type SourceFn = (context: Context) => Promise<Found[]>

const commons: SourceFn = async ({ net, query, count }) => {
  const params = commonsParams({ generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: String(Math.min(count * 3, 30)) })
  const body = obj(await net.json("commons", `${COMMONS_API}?${params}`))
  const pages = Object.values(obj(obj(body.query).pages)) as Page[]
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(commonsResult)
    .filter((found): found is Found => Boolean(found))
    .slice(0, count)
}

/** Wikidata entity by name → its image (P18) and logo (P154) files → Commons thumbnails with license data. */
const wikidata: SourceFn = async ({ net, query, count }) => {
  const language = /\p{Script=Cyrillic}/u.test(query) ? "ru" : "en"
  const search = new URLSearchParams({ action: "wbsearchentities", search: query, language, uselang: language, limit: "5", format: "json", origin: "*" })
  const ids = list(obj(await net.json("wikidata", `${WIKIDATA_API}?${search}`)).search)
    .map((entry) => text(obj(entry).id))
    .filter(Boolean)
  if (!ids.length) return []
  const entities = new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "claims|labels", languages: language, format: "json", origin: "*" })
  const byId = obj(obj(await net.json("wikidata", `${WIKIDATA_API}?${entities}`)).entities)
  const files: Array<{ file: string; label: string }> = []
  for (const id of ids) {
    const entity = obj(byId[id])
    const label = text(obj(obj(entity.labels)[language]).value)
    const claims = obj(entity.claims)
    for (const property of ["P18", "P154"]) {
      const file = text(obj(obj(obj(list(claims[property])[0]).mainsnak).datavalue).value)
      if (file) files.push({ file: file.replace(/_/g, " "), label })
    }
  }
  const wanted = files.slice(0, Math.min(count * 2, 12))
  if (!wanted.length) return []
  const titles = wanted.map(({ file }) => `File:${file}`).join("|")
  const body = obj(await net.json("commons", `${COMMONS_API}?${commonsParams({ titles })}`))
  const pages = new Map<string, Page>()
  for (const page of Object.values(obj(obj(body.query).pages)) as Page[]) pages.set((page.title ?? "").replace(/_/g, " "), page)
  const found: Found[] = []
  for (const { file, label } of wanted) {
    const page = pages.get(`File:${file}`)
    const result = page && commonsResult(page)
    if (result) found.push({ ...result, title: label || result.title })
    if (found.length >= count) break
  }
  return found
}

const pokemonSlug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/♀/g, "-f")
    .replace(/♂/g, "-m")
    .replace(/[.'’:]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const REGIONS: Record<string, string> = { alolan: "alola", galarian: "galar", hisuian: "hisui", paldean: "paldea" }

/** Names to try in order: the whole phrase ("mr-mime", "charizard-mega-x"), a regional form, then the first and last word. */
export function pokemonCandidates(query: string): string[] {
  const words = pokemonSlug(query.replace(/pok[eé]mon|покемон/giu, " ")).split("-").filter(Boolean)
  if (!words.length) return []
  const found = [words.join("-")]
  const region = words.find((word) => REGIONS[word])
  const rest = words.filter((word) => !REGIONS[word])
  if (region && rest.length) found.push(`${rest.join("-")}-${REGIONS[region]}`)
  if (words.length > 1) found.push(words[0]!, words[words.length - 1]!)
  return [...new Set(found)].slice(0, 4)
}

const pokeapi: SourceFn = async ({ net, query }) => {
  for (const name of pokemonCandidates(query)) {
    const data = obj(await net.json("pokeapi", `${POKEAPI}/${encodeURIComponent(name)}`, {}, true))
    const other = obj(obj(data.sprites).other)
    const url = httpsUrl(obj(other["official-artwork"]).front_default) || httpsUrl(obj(other.home).front_default)
    if (!url) continue
    const pokemon = text(data.name) || name
    return [{ url, title: pokemon.replace(/(^|-)([a-z])/g, (_all, dash: string, letter: string) => dash.replace("-", " ") + letter.toUpperCase()), rights: COPYRIGHTED, attribution: "PokeAPI sprites; Pokémon © Nintendo/Game Freak", page_url: `${POKEAPI}/${String(data.id ?? name)}` }]
  }
  return []
}

const ANILIST_FIELDS = {
  anime: "media(search: $q, type: ANIME) { title { romaji english } coverImage { large } siteUrl }",
  manga: "media(search: $q, type: MANGA) { title { romaji english } coverImage { large } siteUrl }",
  character: "characters(search: $q) { name { full } image { large } siteUrl }",
}

const anilist: SourceFn = async ({ net, query, count, topic }) => {
  const kinds = topic === "manga" ? ["manga"] : topic === "anime" ? ["anime"] : topic === "character" ? ["character"] : ["anime", "character"]
  const body = JSON.stringify({
    query: `query ($q: String, $n: Int) { ${kinds.map((kind) => `${kind}: Page(perPage: $n) { ${ANILIST_FIELDS[kind as keyof typeof ANILIST_FIELDS]} }`).join(" ")} }`,
    variables: { q: query, n: count },
  })
  const data = obj(await net.json("anilist", ANILIST_API, { method: "POST", headers: { "Content-Type": "application/json" }, body }))
  if (list(data.errors).length) fail("AniList rejected the search. Continue without images or try again later.")
  const columns = kinds.map((kind) => {
    const page = obj(obj(data.data)[kind])
    const rows = kind === "character" ? list(page.characters) : list(page.media)
    return rows.flatMap((row): Found[] => {
      const entry = obj(row)
      const url = httpsUrl(obj(kind === "character" ? entry.image : entry.coverImage).large)
      const names = obj(kind === "character" ? entry.name : entry.title)
      const title = text(kind === "character" ? names.full : names.english) || text(names.romaji)
      return url && title ? [{ url, title, rights: COPYRIGHTED, attribution: "AniList", page_url: text(entry.siteUrl) }] : []
    })
  })
  // several kinds are interleaved so that one query can show both the series cover and its characters
  const merged: Found[] = []
  for (let i = 0; merged.length < count && columns.some((column) => i < column.length); i++) {
    for (const column of columns) if (column[i] && merged.length < count) merged.push(column[i]!)
  }
  return merged
}

const lucene = (value: string) => value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").replace(/\s+/g, " ").trim()

/** MusicBrainz finds the release group by title (else by artist); only those with a front cover in the Cover Art Archive are returned. */
const COVERART_TIMEOUT_MS = 3_000
/** MusicBrainz is slow to reach from some networks: the whole lookup is cut off so that the caller can fall back in time. */
const COVERART_BUDGET_MS = 5_000

const coverart: SourceFn = async ({ net, query, count }) => {
  const started = Date.now()
  const clean = lucene(query)
  if (!clean) return []
  // the title match comes first (an album called "Abbey Road"); the artist is searched only when no title matches
  let groups: unknown[] = []
  for (const field of ["releasegroup", "artist"]) {
    const search = new URLSearchParams({ query: `${field}:"${clean}"`, fmt: "json", limit: String(Math.min(count * 2, 10)) })
    groups = list(obj(await net.json("musicbrainz", `${MUSICBRAINZ_API}?${search}`, {}, false, { timeoutMs: COVERART_TIMEOUT_MS, retries: 0 }))["release-groups"])
    if (groups.length) break
  }
  const found: Found[] = []
  let checked = 0
  for (const group of groups) {
    if (found.length >= count || checked >= count + 3) break
    if (Date.now() - started > COVERART_BUDGET_MS) {
      if (found.length) break
      fail("Cover Art Archive is too slow to answer.")
    }
    const entry = obj(group)
    const id = text(entry.id)
    if (!id) continue
    checked++
    const url = `${COVER_ART}/${encodeURIComponent(id)}/front-500`
    const present = await net.isImage(url, { source: "caa", timeoutMs: COVERART_TIMEOUT_MS, retries: 0 })
    if (!present) continue
    const artist = list(entry["artist-credit"]).map((credit) => text(obj(credit).name)).filter(Boolean).join(", ")
    const title = text(entry.title)
    found.push({ url, title: artist ? `${title} — ${artist}` : title, rights: COPYRIGHTED, attribution: "Cover Art Archive / MusicBrainz", page_url: `https://musicbrainz.org/release-group/${id}` })
  }
  return found
}

const openlibrary: SourceFn = async ({ net, query, count }) => {
  const search = new URLSearchParams({ q: query, limit: String(Math.min(count * 2, 20)), fields: "key,title,author_name,cover_i" })
  const docs = list(obj(await net.json("openlibrary", `${OPENLIBRARY_API}?${search}`)).docs)
  const found: Found[] = []
  for (const doc of docs) {
    const entry = obj(doc)
    const cover = Number(entry.cover_i)
    const title = text(entry.title)
    if (!Number.isInteger(cover) || cover <= 0 || !title) continue
    const author = list(entry.author_name).map(text).filter(Boolean)[0]
    found.push({ url: `${OPENLIBRARY_COVERS}/${cover}-M.jpg`, title: author ? `${title} — ${author}` : title, rights: COPYRIGHTED, attribution: "Open Library", page_url: `https://openlibrary.org${text(entry.key)}` })
    if (found.length >= count) break
  }
  return found
}

const CHECKED = new Set<string>(["commons", "wikidata", "coverart"])
const SOURCES: Record<Exclude<ImageSource, "auto">, SourceFn> = { commons, wikidata, pokeapi, anilist, coverart, openlibrary }

/** `auto` picks one specialised source from the agent's `topic` (or the wording of the query) and falls back to Commons. */
function choose(query: string, topic: ImageTopic | undefined): Exclude<ImageSource, "auto"> {
  if (topic === "pokemon") return "pokeapi"
  if (topic === "anime" || topic === "manga" || topic === "character") return "anilist"
  if (topic === "music") return "coverart"
  if (topic === "book") return "openlibrary"
  if (topic === "general") return "wikidata"
  if (/pok[eé]mon|покемон/iu.test(query)) return "pokeapi"
  if (/\b(anime|manga)\b|аниме|манга/iu.test(query)) return "anilist"
  if (/\b(album|discography)\b|альбом|дискографи/iu.test(query)) return "coverart"
  if (/\b(novel|book|books)\b|книга|роман/iu.test(query)) return "openlibrary"
  return "commons"
}

/** Image search over the free sources; one instance per server keeps the request queues and the cache. */
export function createImageSearch(options: NetOptions = {}): ImageSearcher {
  const net = createNet(options)
  return async (query, { source = "auto", topic, limit = 5 } = {}) => {
    const text = query.trim()
    if (!text) fail("Give a non-empty image search query.")
    const count = Math.min(Math.max(Math.trunc(limit), 1), MAX_IMAGE_RESULTS)
    const context: Context = { net, query: text, count, topic }
    const run = async (id: Exclude<ImageSource, "auto">) => {
      const found = (await SOURCES[id](context)).map((entry): ImageResult => ({ ...entry, source: id }))
      // Commons/Wikidata (mime from the API) and Cover Art (probed) are already checked; the rest must answer with image/*
      if (!CHECKED.has(id)) {
        const real = await Promise.all(found.map((entry) => net.isImage(entry.url)))
        return found.filter((_entry, index) => real[index])
      }
      return found
    }
    if (source !== "auto") {
      // an explicit source never gets substituted: when it is down the answer is empty and says how to continue
      try {
        return { images: await run(source) }
      } catch (error) {
        return { images: [], note: `${source} недоступен, попробуй source=auto (${error instanceof Error ? error.message : String(error)})` }
      }
    }
    // auto: the chosen source, then the fallbacks in order (MusicBrainz may be unreachable from some networks: coverart tries Wikidata, then Commons)
    const first = choose(text, topic)
    const fallbacks = first === "commons" ? [] : first === "coverart" ? (["wikidata", "commons"] as const) : (["commons"] as const)
    const names = { wikidata: "Wikidata", commons: "Wikimedia Commons" }
    let reason: string
    let failure: unknown
    try {
      const images = await run(first)
      if (images.length || !fallbacks.length) return { images }
      reason = `${first} had no match`
    } catch (error) {
      if (!fallbacks.length) throw error
      failure = error
      reason = `${first} failed: ${error instanceof Error ? error.message : String(error)}`
    }
    for (const next of fallbacks) {
      const images = await run(next).catch(() => [])
      if (images.length) return { images, note: `${reason}; results come from ${names[next]} instead.` }
    }
    if (failure) throw failure
    return { images: [] }
  }
}
