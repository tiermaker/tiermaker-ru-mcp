import { describe, expect, it } from "vitest"
import { createImageSearch, pokemonCandidates } from "../src/images.js"
import type { NetOptions } from "../src/image-net.js"
import { connect, mockFetch, type Calls } from "./helpers.js"

/** An explicit source that fails gives an empty answer with a note, never another source's pictures. */
async function down(search: Promise<{ images: unknown[]; note?: string }>, reason: RegExp) {
  const result = await search
  expect(result.images).toEqual([])
  expect(result.note).toMatch(/недоступен, попробуй source=auto/)
  expect(result.note).toMatch(reason)
}

const fast = { wait: async () => {}, gapMs: 0 }
const searchImages = async (query: string, limit = 5, fetchImpl: typeof fetch = fetch, wait: (ms: number) => Promise<void> = async () => {}) =>
  (await createImageSearch({ fetch: fetchImpl, wait, gapMs: 0 })(query, { source: "commons", limit })).images

describe("search_images", () => {
  it("returns direct image urls with caption, license and author, in search order", async () => {
    const calls: Calls = []
    const { call } = await connect({ fetch: mockFetch(calls) })
    const result = await call("search_images", { query: "car", source: "commons", limit: 2 })
    expect(result.isError).toBe(false)
    const images = result.data.images
    // svg and pdf are dropped; the rest keep the search order
    expect(images.map((image: { title: string }) => image.title)).toEqual(["First car", "Third"])
    expect(images[0]).toEqual({
      url: "https://upload.wikimedia.org/thumb/First_car.jpg/500px-First_car.jpg?utm_source=commons",
      title: "First car",
      license: "CC BY-SA 4.0",
      attribution: "Ann & Bob",
      source: "commons",
      page_url: "https://commons.wikimedia.org/wiki/File:First_car.jpg",
    })
    const request = new URL(calls.find((url) => url.includes("commons.wikimedia.org"))!)
    expect(request.searchParams.get("iiurlwidth")).toBe("500")
    expect(request.searchParams.get("gsrnamespace")).toBe("6")
  })

  it("limits the number of results and reports unknown licenses", async () => {
    const images = await searchImages("car", 10, mockFetch())
    expect(images.map((image) => image.title)).toEqual(["First car", "Third", "Plain"])
    expect(images[2]).toMatchObject({ license: "unknown" })
    expect(images[2]).toMatchObject({ attribution: "Unknown author, via Wikimedia Commons" })
    expect(await searchImages("car", 1, mockFetch())).toHaveLength(1)
  })

  it("never returns a picture wider than 512 px (rounded-up 960px thumbnail, wide reported width, full-size original)", async () => {
    const images = await searchImages("car", 10, mockFetch())
    for (const image of images) {
      expect(Number(/\/(\d+)px-/.exec(image.url)?.[1])).toBeLessThanOrEqual(512)
      expect(image.url).not.toMatch(/Big|Wide|Original/)
    }
  })

  it("turns network and HTTP failures into plain errors, and sends a timeout and user agent", async () => {
    const down = (async () => {
      throw new Error("offline")
    }) as typeof fetch
    const { call } = await connect({ fetch: down })
    const failed = await call("search_images", { query: "car", source: "commons" })
    expect(failed.isError).toBe(false)
    expect(failed.data.images).toEqual([])
    expect(failed.data.note).toMatch(/commons недоступен, попробуй source=auto.*Could not reach Wikimedia Commons/)
    const http = await connect({ fetch: mockFetch() })
    const bad = await http.call("search_images", { query: "broken", source: "commons" })
    expect(bad.isError).toBe(false)
    expect(bad.data.images).toEqual([])
    expect(bad.data.note).toMatch(/HTTP 500/)
    expect((await http.call("search_images", { query: "  " })).isError).toBe(true)

    let init: RequestInit | undefined
    const spy = (async (_url: unknown, options?: RequestInit) => {
      init = options
      return new Response(JSON.stringify({}), { status: 200 })
    }) as unknown as typeof fetch
    expect(await searchImages("x", 5, spy)).toEqual([])
    expect(init?.signal).toBeDefined()
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/^tiermaker-ru-mcp\//)
  })

  it("retries a throttled request with the server's pause", async () => {
    const waits: number[] = []
    let hits = 0
    const flaky = (async (url: string | URL | Request, init?: RequestInit) => {
      hits++
      if (hits < 3) return new Response("slow down", { status: 429, headers: { "retry-after": "2" } })
      return mockFetch()(url, init)
    }) as typeof fetch
    const images = await searchImages("car", 1, flaky, async (ms) => void waits.push(ms))
    expect(images).toHaveLength(1)
    expect(waits.filter((ms) => ms >= 1000)).toEqual([2000, 2000])
    const stuck = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch
    await down(createImageSearch({ fetch: stuck, wait: async () => {}, gapMs: 0 })("car", { source: "commons" }), /429 \(too many requests\)/)
  })

  it("reports an unreadable response as unavailable", async () => {
    const garbage = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch
    await down(createImageSearch({ fetch: garbage, ...fast })("x", { source: "commons" }), /unreadable/)
  })
})

type Handler = (url: URL, init?: RequestInit) => Response | undefined
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
const image = (type = "image/jpeg") => new Response("x", { status: 200, headers: { "content-type": type } })
const CDN_HOSTS = new Set(["raw.githubusercontent.com", "s4.anilist.co", "covers.openlibrary.org"])
const routed = (handler: Handler, calls: string[] = [], cdn = true): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`)
    // image hosts answer HEAD checks with an image unless a test handles them itself
    const response = cdn && init?.method === "HEAD" && CDN_HOSTS.has(url.host) ? image() : handler(url, init)
    if (!response) throw new Error(`unexpected request: ${url}`)
    return response
  }) as typeof fetch
const run = (fetchImpl: typeof fetch, query: string, options: Parameters<ReturnType<typeof createImageSearch>>[1], extra: NetOptions = fast) =>
  createImageSearch({ fetch: fetchImpl, ...extra })(query, options)

describe("pokeapi", () => {
  const artwork = (name: string, id: number) => ({ name, id, sprites: { other: { "official-artwork": { front_default: `https://raw.githubusercontent.com/PokeAPI/sprites/master/${id}.png` } } } })
  const api: Handler = (url) => {
    const name = url.pathname.split("/").pop()!
    if (name === "pikachu") return json(artwork("pikachu", 25))
    if (name === "mr-mime") return json(artwork("mr-mime", 122))
    if (name === "raichu-alola") return json(artwork("raichu-alola", 10100))
    if (name === "bare") return json({ name: "bare", id: 1, sprites: { other: {} } })
    return json({ detail: "Not found." }, 404)
  }

  it("normalises names and returns the official artwork as copyrighted", async () => {
    expect(pokemonCandidates("  Mr. Mime ")[0]).toBe("mr-mime")
    expect(pokemonCandidates("Pokémon Alolan Raichu")).toContain("raichu-alola")
    expect(pokemonCandidates("Farfetch’d")[0]).toBe("farfetchd")
    expect(pokemonCandidates("Nidoran♀")[0]).toBe("nidoran-f")
    const calls: string[] = []
    const result = await run(routed(api, calls), "Pikachu", { source: "pokeapi" })
    expect(result.images).toEqual([
      {
        url: "https://raw.githubusercontent.com/PokeAPI/sprites/master/25.png",
        title: "Pikachu",
        source: "pokeapi",
        rights: "copyrighted, used by reference",
        attribution: "PokeAPI sprites; Pokémon © Nintendo/Game Freak",
        page_url: "https://pokeapi.co/api/v2/pokemon/25",
      },
    ])
    expect((await run(routed(api), "mr mime", { source: "pokeapi" })).images[0]?.title).toBe("Mr Mime")
    expect(calls).toEqual(["GET https://pokeapi.co/api/v2/pokemon/pikachu", "HEAD https://raw.githubusercontent.com/PokeAPI/sprites/master/25.png"])
  })

  it("tries the shorter names, and reports nothing for unknown or artless pokemon", async () => {
    const calls: string[] = []
    expect((await run(routed(api, calls), "Pikachu Gigantamax", { source: "pokeapi" })).images).toHaveLength(1)
    expect(calls.filter((call) => call.startsWith("GET")).map((call) => call.split("/").pop())).toEqual(["pikachu-gigantamax", "pikachu"])
    expect((await run(routed(api), "Missingno", { source: "pokeapi" })).images).toEqual([])
    expect((await run(routed(api), "bare", { source: "pokeapi" })).images).toEqual([])
  })

  it("fails plainly on 429 and on a broken body", async () => {
    await down(run(routed(() => json({}, 429)), "pikachu", { source: "pokeapi" }), /PokeAPI answered with HTTP 429 \(too many requests\)/)
    await down(run(routed(() => new Response("<html>")), "pikachu", { source: "pokeapi" }), /unreadable/)
  })
})

describe("anilist", () => {
  const reply = (body: unknown): Handler => () => json(body)
  const data = {
    data: {
      anime: { media: [{ title: { romaji: "Shingeki no Kyojin", english: "Attack on Titan" }, coverImage: { large: "https://s4.anilist.co/cover.jpg" }, siteUrl: "https://anilist.co/anime/16498" }] },
      character: { characters: [{ name: { full: "Levi Ackerman" }, image: { large: "https://s4.anilist.co/levi.png" }, siteUrl: "https://anilist.co/character/45627" }] },
    },
  }

  it("posts one GraphQL request, interleaves series and characters and marks them copyrighted", async () => {
    let sent: { query: string; variables: { q: string; n: number } } | undefined
    const calls: string[] = []
    const fetchImpl = routed((_url, init) => {
      sent = JSON.parse(String(init?.body))
      return json(data)
    }, calls)
    const result = await run(fetchImpl, "Attack on Titan", { source: "anilist", limit: 4 })
    expect(calls.filter((call) => !call.startsWith("HEAD"))).toEqual(["POST https://graphql.anilist.co/"])
    expect(sent?.variables).toEqual({ q: "Attack on Titan", n: 4 })
    expect(sent?.query).toContain("type: ANIME")
    expect(result.images.map((entry) => entry.title)).toEqual(["Attack on Titan", "Levi Ackerman"])
    expect(result.images[0]).toEqual({
      url: "https://s4.anilist.co/cover.jpg",
      title: "Attack on Titan",
      source: "anilist",
      rights: "copyrighted, used by reference",
      attribution: "AniList",
      page_url: "https://anilist.co/anime/16498",
    })
  })

  it("asks only for what the topic names", async () => {
    let query = ""
    const fetchImpl = routed((_url, init) => {
      query = JSON.parse(String(init?.body)).query
      return json({ data: { character: { characters: [] } } })
    })
    expect((await run(fetchImpl, "Levi", { source: "anilist", topic: "character" })).images).toEqual([])
    expect(query).toContain("characters(search")
    expect(query).not.toContain("media(")
    await run(routed((_url, init) => ((query = JSON.parse(String(init?.body)).query), json({ data: {} }))), "Berserk", { source: "anilist", topic: "manga" })
    expect(query).toContain("type: MANGA")
  })

  it("fails plainly on 429, GraphQL errors and a broken body", async () => {
    await expect(run(routed(reply({})), "x", { source: "anilist" }).then((r) => r.images)).resolves.toEqual([])
    await down(run(routed(() => json({}, 429)), "x", { source: "anilist" }), /AniList answered with HTTP 429/)
    await down(run(routed(reply({ errors: [{ message: "bad" }] })), "x", { source: "anilist" }), /AniList rejected/)
    await down(run(routed(() => new Response("nope")), "x", { source: "anilist" }), /unreadable/)
  })
})

describe("coverart", () => {
  const groups = {
    "release-groups": [
      { id: "aaa", title: "OK Computer", "artist-credit": [{ name: "Radiohead" }] },
      { id: "bbb", title: "No art", "artist-credit": [{ name: "Radiohead" }] },
      { id: "ccc", title: "Kid A", "artist-credit": [{ name: "Radiohead" }] },
    ],
  }
  const api: Handler = (url) => {
    if (url.host === "musicbrainz.org") return json(groups)
    if (url.host === "coverartarchive.org") return url.pathname.includes("/bbb/") ? new Response("", { status: 404 }) : image()
    return undefined
  }

  it("searches MusicBrainz and keeps only releases with a front cover", async () => {
    const calls: string[] = []
    let search: URLSearchParams | undefined
    const result = await run(
      routed((url, init) => ((search = url.host === "musicbrainz.org" ? url.searchParams : search), api(url, init)), calls),
      'OK "Computer"',
      { source: "coverart", limit: 5 },
    )
    expect(search?.get("query")).toBe('releasegroup:"OK Computer"')
    expect(result.images.map((entry) => entry.title)).toEqual(["OK Computer — Radiohead", "Kid A — Radiohead"])
    expect(result.images[0]).toEqual({
      url: "https://coverartarchive.org/release-group/aaa/front-500",
      title: "OK Computer — Radiohead",
      source: "coverart",
      rights: "copyrighted, used by reference",
      attribution: "Cover Art Archive / MusicBrainz",
      page_url: "https://musicbrainz.org/release-group/aaa",
    })
    expect(calls.filter((call) => call.startsWith("HEAD"))).toHaveLength(3)
  })

  it("searches by artist when no title matches", async () => {
    const queries: string[] = []
    const byArtist: Handler = (url) => {
      if (url.host !== "musicbrainz.org") return image()
      queries.push(url.searchParams.get("query")!)
      return json(url.searchParams.get("query")!.startsWith("artist:") ? groups : { "release-groups": [] })
    }
    expect((await run(routed(byArtist), "Radiohead", { source: "coverart" })).images).toHaveLength(3)
    expect(queries).toEqual(['releasegroup:"Radiohead"', 'artist:"Radiohead"'])
  })

  it("is empty without matches or when the cover host is not an image, and fails plainly on 429 and a broken body", async () => {
    expect((await run(routed(() => json({ "release-groups": [] })), "zzz", { source: "coverart" })).images).toEqual([])
    const html: Handler = (url) => (url.host === "musicbrainz.org" ? json(groups) : image("text/html"))
    expect((await run(routed(html), "x", { source: "coverart" })).images).toEqual([])
    await down(run(routed(() => json({}, 429)), "x", { source: "coverart" }), /MusicBrainz answered with HTTP 429/)
    await down(run(routed(() => new Response("<html>")), "x", { source: "coverart" }), /unreadable/)
  })
})

describe("openlibrary", () => {
  const docs = { docs: [{ key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], cover_i: 123 }, { key: "/works/OL2W", title: "No cover" }] }

  it("returns medium covers of books that have one", async () => {
    let search: URLSearchParams | undefined
    const result = await run(routed((url) => ((search = url.searchParams), json(docs))), "dune", { source: "openlibrary" })
    expect(search?.get("q")).toBe("dune")
    expect(result.images).toEqual([
      {
        url: "https://covers.openlibrary.org/b/id/123-M.jpg",
        title: "Dune — Frank Herbert",
        source: "openlibrary",
        rights: "copyrighted, used by reference",
        attribution: "Open Library",
        page_url: "https://openlibrary.org/works/OL1W",
      },
    ])
  })

  it("is empty for no matches and fails plainly on 429 and a broken body", async () => {
    expect((await run(routed(() => json({ docs: [] })), "zzz", { source: "openlibrary" })).images).toEqual([])
    await down(run(routed(() => json({}, 429)), "x", { source: "openlibrary" }), /Open Library answered with HTTP 429/)
    await down(run(routed(() => new Response("<html>")), "x", { source: "openlibrary" }), /unreadable/)
  })
})

describe("wikidata", () => {
  const file = (name: string, mime = "image/jpeg", thumb = `https://upload.wikimedia.org/thumb/${name}/500px-${name}`) => ({
    title: `File:${name}`,
    imageinfo: [{ thumburl: thumb, thumbwidth: 500, mime, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`, extmetadata: { LicenseShortName: { value: "CC0" } } }],
  })
  const api: Handler = (url) => {
    const action = url.searchParams.get("action")
    if (action === "wbsearchentities") return json({ search: url.searchParams.get("search") === "nothing" ? [] : [{ id: "Q1" }, { id: "Q2" }] })
    if (action === "wbgetentities") {
      const claim = (value: string) => [{ mainsnak: { datavalue: { value } } }]
      return json({ entities: { Q1: { labels: { en: { value: "Eiffel Tower" } }, claims: { P18: claim("Tour_Eiffel.jpg") } }, Q2: { labels: { en: { value: "Acme" } }, claims: { P154: claim("Acme logo.svg") } } } })
    }
    if (url.searchParams.get("titles")) return json({ query: { pages: { "1": file("Tour Eiffel.jpg"), "2": file("Acme logo.svg", "image/svg+xml", "https://upload.wikimedia.org/thumb/Acme_logo.svg/500px-Acme_logo.svg.png") } } })
    return undefined
  }

  it("goes from the entity to its image and logo files on Commons", async () => {
    const calls: string[] = []
    const result = await run(routed(api, calls), "Eiffel Tower", { source: "wikidata" })
    expect(result.images).toEqual([
      { url: "https://upload.wikimedia.org/thumb/Tour Eiffel.jpg/500px-Tour Eiffel.jpg", title: "Eiffel Tower", source: "wikidata", license: "CC0", attribution: "Unknown author, via Wikimedia Commons", page_url: "https://commons.wikimedia.org/wiki/File:Tour Eiffel.jpg" },
      { url: "https://upload.wikimedia.org/thumb/Acme_logo.svg/500px-Acme_logo.svg.png", title: "Acme", source: "wikidata", license: "CC0", attribution: "Unknown author, via Wikimedia Commons", page_url: "https://commons.wikimedia.org/wiki/File:Acme logo.svg" },
    ])
    expect(calls).toHaveLength(3)
  })

  it("is empty without a match, and fails plainly on 429 and a broken body", async () => {
    expect((await run(routed(api), "nothing", { source: "wikidata" })).images).toEqual([])
    await down(run(routed(() => json({}, 429)), "x", { source: "wikidata" }), /Wikidata answered with HTTP 429/)
    await down(run(routed(() => new Response("<html>")), "x", { source: "wikidata" }), /unreadable/)
  })
})

describe("auto, queue and cache", () => {
  const poke: Handler = (url) => (url.host === "pokeapi.co" ? json({ name: "eevee", id: 133, sprites: { other: { "official-artwork": { front_default: "https://raw.githubusercontent.com/a/133.png" } } } }) : undefined)

  it("routes by topic or wording to one source, without asking the others", async () => {
    const calls: string[] = []
    const search = createImageSearch({ fetch: routed(poke, calls), ...fast })
    expect((await search("Eevee", { topic: "pokemon" })).images[0]?.source).toBe("pokeapi")
    expect((await search("pokémon Eevee")).images[0]?.source).toBe("pokeapi")
    expect(calls.filter((call) => !call.startsWith("HEAD")).every((call) => call.includes("pokeapi.co"))).toBe(true)
  })

  it("falls back to Commons, with a note, when the chosen source is empty or down", async () => {
    const commonsOnly: Handler = (url) => {
      if (url.host === "commons.wikimedia.org") return json({ query: { pages: { "1": { title: "File:Cat.jpg", index: 1, imageinfo: [{ thumburl: "https://upload.wikimedia.org/thumb/Cat.jpg/500px-Cat.jpg", thumbwidth: 500, mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Cat.jpg" }] } } } })
      if (url.host === "pokeapi.co") return json({}, 404)
      if (url.host === "openlibrary.org") return json({}, 400)
      return undefined
    }
    const search = createImageSearch({ fetch: routed(commonsOnly), ...fast })
    const empty = await search("Missingno", { topic: "pokemon" })
    expect(empty.images.map((entry) => entry.source)).toEqual(["commons"])
    expect(empty.note).toMatch(/pokeapi had no match/)
    const broken = await search("a cat", { topic: "book" })
    expect(broken.images).toHaveLength(1)
    expect(broken.note).toMatch(/openlibrary failed/)
    // plain queries go straight to Commons, an explicit source never falls back
    expect((await search("cat")).note).toBeUndefined()
    await down(search("Missingno", { source: "openlibrary" }), /HTTP 400/)
  })

  it("spaces requests to one source by a second, retries 429/5xx with backoff and serves repeats from the cache", async () => {
    let clock = 0
    const waits: number[] = []
    let hits = 0
    const calls: string[] = []
    const flaky: Handler = (url) => {
      hits++
      if (hits === 1) return json({}, 429, { "retry-after": "3" })
      if (hits === 2) return json({}, 503)
      return poke(url)
    }
    const search = createImageSearch({
      fetch: routed(flaky, calls),
      now: () => clock,
      wait: async (ms) => {
        waits.push(ms)
        clock += ms
      },
    })
    expect((await search("Eevee", { source: "pokeapi" })).images).toHaveLength(1)
    const apiCalls = () => calls.filter((call) => !call.startsWith("HEAD"))
    expect(apiCalls()).toHaveLength(3)
    // the retry pause is the server's 3 s, then 2 s of backoff; the 1 s gap is already covered by them
    expect(waits).toEqual([3000, 2000])
    await search("eevee", { source: "pokeapi" })
    expect(calls).toHaveLength(4)
    clock += 11 * 60_000
    await search("eevee", { source: "pokeapi" })
    expect(apiCalls()).toHaveLength(4)
    expect(waits).toEqual([3000, 2000])
  })

  it("never sends two requests to a source at once", async () => {
    let open = 0
    let peak = 0
    const slow = (async () => {
      open++
      peak = Math.max(peak, open)
      await new Promise((done) => setTimeout(done, 5))
      open--
      return json({ docs: [] })
    }) as unknown as typeof fetch
    const search = createImageSearch({ fetch: slow, ...fast })
    await Promise.all(["a", "b", "c"].map((query) => search(query, { source: "openlibrary" })))
    expect(peak).toBe(1)
  })

  it("gives up after the retries", async () => {
    const waits: number[] = []
    await down(run(routed(() => json({}, 500)), "x", { source: "pokeapi" }, { wait: async (ms) => void waits.push(ms), gapMs: 0 }), /HTTP 500/)
    expect(waits).toEqual([1000, 2000, 3000])
  })

  it("drops pictures that are not image/* (checked once per url, then cached; HEAD-less hosts are asked with GET)", async () => {
    const calls: string[] = []
    const search = createImageSearch({
      fetch: routed((url, init) => {
        if (url.host === "pokeapi.co") return poke(url)
        if (init?.method === "HEAD") return new Response("", { status: 405 })
        if (init?.method === "GET") return new Response("x", { status: 206, headers: { "content-type": "image/png" } })
        return undefined
      }, calls, false),
      ...fast,
    })
    expect((await search("Eevee", { source: "pokeapi" })).images).toHaveLength(1)
    expect(calls.filter((call) => call.includes("githubusercontent"))).toEqual(["HEAD https://raw.githubusercontent.com/a/133.png", "GET https://raw.githubusercontent.com/a/133.png"])
    await search("eevee", { source: "pokeapi" })
    expect(calls.filter((call) => call.includes("githubusercontent"))).toHaveLength(2)

    const html = createImageSearch({ fetch: routed((url) => (url.host === "pokeapi.co" ? poke(url) : image("text/html")), [], false), ...fast })
    expect((await html("Eevee", { source: "pokeapi" })).images).toEqual([])
    const down = createImageSearch({ fetch: routed((url) => (url.host === "pokeapi.co" ? poke(url) : new Response("", { status: 404 })), [], false), ...fast })
    expect((await down("Eevee", { source: "pokeapi" })).images).toEqual([])
  })

  it("auto with music falls back to Wikidata, then Commons, when MusicBrainz cannot be reached, and does not retry it for a while", async () => {
    const calls: string[] = []
    const wikidataApi: Handler = (url) => {
      if (url.host === "musicbrainz.org") throw new Error("connect timeout")
      const action = url.searchParams.get("action")
      if (action === "wbsearchentities") return json({ search: [{ id: "Q1" }] })
      if (action === "wbgetentities") return json({ entities: { Q1: { labels: { en: { value: "OK Computer" } }, claims: { P18: [{ mainsnak: { datavalue: { value: "OK_Computer.jpg" } } }] } } } })
      return json({ query: { pages: { "1": { title: "File:OK Computer.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/thumb/OK_Computer.jpg/500px-OK_Computer.jpg", thumbwidth: 500, mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:OK_Computer.jpg" }] } } } })
    }
    const search = createImageSearch({
      fetch: routed(wikidataApi, calls),
      now: () => 0,
      wait: async () => {},
    })
    const first = await search("OK Computer", { topic: "music" })
    expect(first.images.map((entry) => [entry.source, entry.attribution])).toEqual([["wikidata", "Unknown author, via Wikimedia Commons"]])
    expect(first.note).toMatch(/coverart failed: Could not reach MusicBrainz.*; results come from Wikidata instead/)
    // a second album within the cool-down does not wait for MusicBrainz again
    await search("Kid A", { topic: "music" })
    expect(calls.filter((call) => call.includes("musicbrainz"))).toHaveLength(1)
    // when Wikidata knows nothing either, Commons answers
    const commonsOnly = createImageSearch({
      fetch: routed((url) => {
        if (url.host === "musicbrainz.org") throw new Error("connect timeout")
        if (url.host === "www.wikidata.org") return json({ search: [] })
        return json({ query: { pages: { "1": { title: "File:Cover.jpg", index: 1, imageinfo: [{ thumburl: "https://upload.wikimedia.org/thumb/Cover.jpg/500px-Cover.jpg", thumbwidth: 500, mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Cover.jpg" }] } } } })
      }),
      ...fast,
    })
    expect((await commonsOnly("Obscure album", { topic: "music" })).images.map((entry) => entry.source)).toEqual(["commons"])
    // nothing anywhere: the original error
    const dead = createImageSearch({ fetch: routed(() => { throw new Error("offline") }), ...fast })
    await expect(dead("x", { topic: "music" })).rejects.toThrow(/Could not reach MusicBrainz/)
  })

  it("an explicit source is never replaced by another one: empty result and a note (coverart and the others)", async () => {
    const calls: string[] = []
    const search = createImageSearch({
      fetch: routed((url) => {
        if (url.host === "musicbrainz.org") throw new Error("connect timeout")
        if (url.host === "pokeapi.co") return json({}, 503)
        return json({ search: [{ id: "Q1" }], query: { pages: {} } })
      }, calls),
      ...fast,
    })
    for (const source of ["coverart", "pokeapi"] as const) {
      const result = await search("OK Computer", { source })
      expect(result.images).toEqual([])
      expect(result.note).toMatch(new RegExp(`^${source} недоступен, попробуй source=auto`))
    }
    // nothing but the chosen services was asked: no Wikidata or Commons substitute
    expect(calls.every((call) => /musicbrainz|pokeapi/.test(call))).toBe(true)
  })
})
