import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { decodePayload } from "../src/codec.js"
import { resolveShortLinks } from "../src/config.js"
import { BASE, connect, mockFetch, type Calls } from "./helpers.js"

async function board(call: Awaited<ReturnType<typeof connect>>["call"], args: Record<string, unknown> = { title: "Test" }) {
  const created = await call("create_tierlist", args)
  expect(created.isError).toBe(false)
  return created.data.board_id as string
}

describe("catalog tools", () => {
  it("searches, gets a template and lists categories", async () => {
    const calls: Calls = []
    const { call } = await connect({ fetch: mockFetch(calls) })
    const search = await call("search_templates", { query: "fruit", category: "food", limit: 1 })
    expect(search.data.templates).toHaveLength(1)
    expect(search.data.templates[0]).toMatchObject({ slug: "fruits", category: "food", item_count: 3 })
    expect(calls[0]).toBe(`${BASE}/api/templates/catalog/?q=fruit&category=food`)

    const template = await call("get_template", { slug: "fruits" })
    expect(template.data.items.map((i: { image_url?: string }) => i.image_url)).toEqual([
      "https://img.example/apple.png",
      `${BASE}/api/media/pear.png`,
      undefined,
    ])
    expect((await call("list_categories")).data.categories[0].slug).toBe("food")
  })

  it("explains a missing template", async () => {
    const { call } = await connect()
    const result = await call("get_template", { slug: "missing" })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/Not found/)
  })

  it("reports an unreachable catalog without throwing", async () => {
    const failing = (async () => {
      throw new Error("offline")
    }) as typeof fetch
    const { call } = await connect({ fetch: failing })
    const result = await call("list_categories")
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/Could not reach/)
  })
})

describe("board tools", () => {
  it("creates a default S/A/B/C/D board", async () => {
    const { call } = await connect()
    const created = await call("create_tierlist", { title: "Games" })
    expect(created.data.tiers.map((t: { label: string }) => t.label)).toEqual(["S", "A", "B", "C", "D"])
    expect(created.data.tiers[0].color).toBe("#dc2626")
  })

  it("creates a board from a template with items in the pool", async () => {
    const { call } = await connect()
    const created = await call("create_tierlist", { title: "Fruits", template_slug: "fruits" })
    expect(created.data.template_slug).toBe("fruits")
    expect(created.data.pool_item_ids).toEqual(["i1", "i2", "i3"])
    const full = await call("get_tierlist", { board_id: created.data.board_id })
    expect(full.data.items.map((i: { label: string }) => i.label)).toEqual(["Apple", "Pear", "Plum"])
  })

  it("creates a board with custom tiers", async () => {
    const { call } = await connect()
    const created = await call("create_tierlist", { title: "x", tiers: [{ label: "Top" }, { label: "Low", color: "navy" }] })
    expect(created.data.tiers.map((t: { id: string; label: string; color: string }) => [t.id, t.label, t.color])).toEqual([
      ["t1", "Top", "#dc2626"],
      ["t2", "Low", "#1e3a8a"],
    ])
  })

  it("set_tiers keeps items of tiers with the same id and frees the rest", async () => {
    const { call } = await connect()
    const id = await board(call)
    await call("add_items", { board_id: id, items: [{ label: "a" }, { label: "b" }] })
    await call("place_items", { board_id: id, placements: { S: ["i1"], A: ["i2"] } })
    const result = await call("set_tiers", {
      board_id: id,
      tiers: [{ id: "S", label: "Best", color: "#ff0000" }, { label: "Meh" }],
    })
    expect(result.data.tiers[0]).toMatchObject({ id: "S", label: "Best", item_ids: ["i1"] })
    expect(result.data.tiers[1].label).toBe("Meh")
    expect(result.data.pool_item_ids).toEqual(["i2"])
  })

  it("update_tier and remove_tier", async () => {
    const { call } = await connect()
    const id = await board(call)
    await call("add_items", { board_id: id, items: [{ label: "a" }] })
    await call("place_items", { board_id: id, placements: { D: ["i1"] } })
    const moved = await call("update_tier", { board_id: id, tier_id: "D", label: "Worst", color: "#000", position: 0 })
    expect(moved.data.tiers.map((t: { id: string }) => t.id)).toEqual(["D", "S", "A", "B", "C"])
    expect(moved.data.tiers[0]).toMatchObject({ label: "Worst", color: "#000" })
    const removed = await call("remove_tier", { board_id: id, tier_id: "D" })
    expect(removed.data.tiers).toHaveLength(4)
    expect(removed.data.pool_item_ids).toEqual(["i1"])
    expect((await call("remove_tier", { board_id: id, tier_id: "D" })).isError).toBe(true)
  })

  it("adds, updates and removes items", async () => {
    const { call } = await connect()
    const id = await board(call)
    const added = await call("add_items", {
      board_id: id,
      items: [{ label: "a" }, { image_url: "https://img.example/ok.png" }, { label: "c", image_url: "https://img.example/ok.png" }],
    })
    expect(added.data.added_item_ids).toEqual(["i1", "i2", "i3"])
    await call("update_item", { board_id: id, item_id: "i1", label: "A!" })
    await call("update_item", { board_id: id, item_id: "i3", image_url: null })
    expect((await call("update_item", { board_id: id, item_id: "i2", image_url: null })).text).toMatch(/must keep/)
    await call("place_items", { board_id: id, placements: { S: ["i1", "i3"] } })
    const removed = await call("remove_items", { board_id: id, item_ids: ["i3"] })
    expect(removed.data.tiers[0].item_ids).toEqual(["i1"])
    const full = await call("get_tierlist", { board_id: id })
    expect(full.data.items).toEqual([
      { id: "i1", label: "A!" },
      { id: "i2", image_url: "https://img.example/ok.png" },
    ])
    expect((await call("remove_items", { board_id: id, item_ids: ["zzz"] })).text).toMatch(/Unknown item/)
  })

  it("place_items keeps array order, steals from other tiers and leaves unlisted tiers alone", async () => {
    const { call } = await connect()
    const id = await board(call)
    await call("add_items", { board_id: id, items: ["a", "b", "c", "d"].map((label) => ({ label })) })
    await call("place_items", { board_id: id, placements: { S: ["i3", "i1"], B: ["i2"] } })
    const result = await call("place_items", { board_id: id, placements: { A: ["i1", "i4"] } })
    const byTier = Object.fromEntries(result.data.tiers.map((t: { id: string; item_ids: string[] }) => [t.id, t.item_ids]))
    expect(byTier).toMatchObject({ S: ["i3"], A: ["i1", "i4"], B: ["i2"], C: [], D: [] })
    expect(result.data.pool_item_ids).toEqual([])
    const dropped = await call("place_items", { board_id: id, placements: { A: ["i4"] } })
    expect(dropped.data.pool_item_ids).toEqual(["i1"])
  })

  it("place_items rejects unknown ids and duplicates", async () => {
    const { call } = await connect()
    const id = await board(call)
    await call("add_items", { board_id: id, items: [{ label: "a" }] })
    expect((await call("place_items", { board_id: id, placements: { S: ["nope"] } })).text).toMatch(/Unknown item/)
    expect((await call("place_items", { board_id: id, placements: { X: ["i1"] } })).text).toMatch(/Unknown tier/)
    expect((await call("place_items", { board_id: id, placements: { S: ["i1"], A: ["i1"] } })).text).toMatch(/more than once/)
  })

  it("move_item between tiers, positions and the pool", async () => {
    const { call } = await connect()
    const id = await board(call)
    await call("add_items", { board_id: id, items: ["a", "b", "c"].map((label) => ({ label })) })
    await call("place_items", { board_id: id, placements: { S: ["i1", "i2"] } })
    let r = await call("move_item", { board_id: id, item_id: "i3", tier_id: "S", position: 1 })
    expect(r.data.tiers[0].item_ids).toEqual(["i1", "i3", "i2"])
    r = await call("move_item", { board_id: id, item_id: "i1", tier_id: "A" })
    expect(r.data.tiers[0].item_ids).toEqual(["i3", "i2"])
    expect(r.data.tiers[1].item_ids).toEqual(["i1"])
    r = await call("move_item", { board_id: id, item_id: "i2", tier_id: "pool" })
    expect(r.data.pool_item_ids).toEqual(["i2"])
    r = await call("move_item", { board_id: id, item_id: "i1", tier_id: "pool", position: 0 })
    expect(r.data.pool_item_ids).toEqual(["i1", "i2"])
    expect((await call("move_item", { board_id: id, item_id: "i1", tier_id: "Q" })).text).toMatch(/Unknown tier/)
  })

  it("unknown board is a clear error", async () => {
    const { call } = await connect()
    const result = await call("get_tierlist", { board_id: "nope" })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/not found/)
  })
})

describe("limits", () => {
  it("rejects the 201st item", async () => {
    const { call } = await connect()
    const id = await board(call)
    const items = Array.from({ length: 200 }, (_, i) => ({ label: `item ${i}` }))
    expect((await call("add_items", { board_id: id, items })).isError).toBe(false)
    const over = await call("add_items", { board_id: id, items: [{ label: "one more" }] })
    expect(over.isError).toBe(true)
    expect(over.text).toMatch(/at most 200 items/)
    const tooMany = await call("add_items", { board_id: id, items: [...items, { label: "x" }] })
    expect(tooMany.isError).toBe(true)
  })

  it("rejects 21 tiers", async () => {
    const { call } = await connect()
    const tiers = Array.from({ length: 21 }, (_, i) => ({ label: `T${i}` }))
    expect((await call("create_tierlist", { title: "x", tiers })).isError).toBe(true)
    const id = await board(call)
    expect((await call("set_tiers", { board_id: id, tiers })).isError).toBe(true)
  })

  it("rejects javascript: and data: image urls, bad colors and long text", async () => {
    const { call } = await connect()
    const id = await board(call)
    expect((await call("add_items", { board_id: id, items: [{ image_url: "javascript:alert(1)" }] })).text).toMatch(/http or https/)
    expect((await call("add_items", { board_id: id, items: [{ image_url: "data:image/png;base64,AAAA" }] })).text).toMatch(/http or https/)
    expect((await call("add_items", { board_id: id, items: [{}] })).text).toMatch(/needs a label/)
    expect((await call("update_tier", { board_id: id, tier_id: "S", color: "url(x)" })).text).toMatch(/Unsupported color "url\(x\)".*#ef4444/)
    expect((await call("add_items", { board_id: id, items: [{ label: "x".repeat(129) }] })).text).toMatch(/longer than 128/)
    expect((await call("create_tierlist", { title: "" })).isError).toBe(true)
  })
})

describe("output tools", () => {
  it("get_editor_link returns a link that decodes back to the board", async () => {
    const { call } = await connect({ baseUrl: "http://localhost:3000" })
    const id = await board(call, { title: "Games", template_slug: undefined })
    await call("add_items", { board_id: id, items: [{ label: "Zelda" }, { label: "Mario", image_url: "https://img.example/ok.png" }] })
    await call("place_items", { board_id: id, placements: { S: ["i2"] } })
    const { data } = await call("get_editor_link", { board_id: id })
    expect(data.url.startsWith("http://localhost:3000/create#tm=")).toBe(true)
    const decoded = decodePayload(data.url.split("#tm=")[1])
    expect(decoded.title).toBe("Games")
    expect(decoded.tiers.map((t) => t.id)).toEqual(["S", "A", "B", "C", "D"])
    expect(decoded.placements.S).toEqual(["i2"])
    expect(decoded.items).toEqual([{ id: "i1", label: "Zelda" }, { id: "i2", label: "Mario", imageUrl: "https://img.example/ok.png" }])
  })

  it("get_editor_link gives a ready markdown line and saves the url next to the PNG", async () => {
    const { call, outputDir } = await connect({ baseUrl: "http://localhost:3000" })
    const id = await board(call, { title: "Games" })
    await call("add_items", { board_id: id, items: [{ label: "Zelda" }] })
    await call("render_image", { board_id: id })
    const { data } = await call("get_editor_link", { board_id: id })
    expect(data.markdown).toBe(`[Открыть в редакторе](${data.url})`)
    expect(data.link_file).toBe(`${outputDir}/games.link.txt`)
    expect(readFileSync(data.link_file, "utf8")).toBe(`${data.url}\n`)
  })

  it("get_editor_link puts the link file beside a PNG written to a custom path", async () => {
    const { call, outputDir } = await connect()
    const id = await board(call, { title: "Games" })
    await call("add_items", { board_id: id, items: [{ label: "Zelda" }] })
    await call("render_image", { board_id: id, output_path: `${outputDir}/sub/custom.png` })
    const { data } = await call("get_editor_link", { board_id: id })
    expect(data.link_file).toBe(`${outputDir}/sub/custom.link.txt`)
  })

  it("falls back to a file when the board is too big for a link", async () => {
    const { call, outputDir } = await connect()
    const id = await board(call, { title: "Big board" })
    const batch = () =>
      Array.from({ length: 100 }, () => ({
        image_url: `https://images.example/${Array.from({ length: 16 }, () => crypto.randomUUID()).join("-")}.png`,
      }))
    await call("add_items", { board_id: id, items: batch() })
    await call("add_items", { board_id: id, items: batch() })
    const { data } = await call("get_editor_link", { board_id: id })
    expect(data.url).toBeUndefined()
    expect(data.file).toBe(`${outputDir}/big-board.tierlist.json`)
    expect(data.instructions).toMatch(/Импорт из файла/)
    expect(JSON.parse(readFileSync(data.file, "utf8")).items).toHaveLength(200)
  })

  it("export_json writes the import format", async () => {
    const { call, outputDir } = await connect()
    const id = await board(call, { title: "Export me" })
    await call("add_items", { board_id: id, items: [{ label: "a" }] })
    const { data } = await call("export_json", { board_id: id })
    expect(data.file).toBe(`${outputDir}/export-me.tierlist.json`)
    const json = JSON.parse(readFileSync(data.file, "utf8"))
    expect(json).toMatchObject({ version: 1, title: "Export me", items: [{ id: "i1", label: "a" }] })
    expect(json.placements).toEqual({ S: [], A: [], B: [], C: [], D: [] })
    const custom = await call("export_json", { board_id: id, output_path: `${outputDir}/nested/b.tierlist.json` })
    expect(existsSync(custom.data.file)).toBe(true)
  })
})

describe("short links", () => {
  type Post = { url: string; init?: RequestInit }

  function draftFetch(reply: () => Response | Promise<Response>, posts: Post[] = []): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/drafts")) {
        posts.push({ url, init })
        return reply()
      }
      throw new Error(`unexpected request: ${url}`)
    }) as typeof fetch
  }

  async function boardWithItem(call: Awaited<ReturnType<typeof connect>>["call"]) {
    const id = await board(call, { title: "Games" })
    await call("add_items", { board_id: id, items: [{ label: "Zelda" }] })
    return id
  }

  it("saves the board on the site and returns the short link", async () => {
    const posts: Post[] = []
    const fetch = draftFetch(
      () => new Response(JSON.stringify({ id: "Ab3dEf9hJk", url: "https://tiermaker.ru/s/Ab3dEf9hJk", expires_at: "2027-04-24T00:00:00Z" }), { status: 201 }),
      posts,
    )
    const { call, outputDir } = await connect({ fetch, baseUrl: "http://localhost:3000", shortLinks: true })
    const id = await boardWithItem(call)

    const { data } = await call("get_editor_link", { board_id: id })

    expect(data.url).toBe("http://localhost:3000/s/Ab3dEf9hJk")
    expect(data.markdown).toBe("[Открыть в редакторе](http://localhost:3000/s/Ab3dEf9hJk)")
    expect(data.expires_at).toBe("2027-04-24T00:00:00Z")
    expect(data.note).toBeUndefined()
    expect(readFileSync(`${outputDir}/games.link.txt`, "utf8")).toBe("http://localhost:3000/s/Ab3dEf9hJk\n")
    expect(posts).toHaveLength(1)
    expect(posts[0]?.url).toBe("http://localhost:3000/api/drafts")
    const sent = JSON.parse(String(posts[0]?.init?.body))
    expect(decodePayload(sent.payload).title).toBe("Games")
  })

  it.each([
    ["rate limit", () => new Response("{}", { status: 429 }), /limit/],
    ["server error", () => new Response("{}", { status: 500 }), /HTTP 500/],
    ["bad answer", () => new Response(JSON.stringify({ id: "../x" }), { status: 201 }), /unreadable/],
    ["network error", () => Promise.reject(new Error("down")), /reached/],
  ])("falls back to the full link with a note on %s", async (_name, reply, reason) => {
    const { call } = await connect({ fetch: draftFetch(reply as () => Response), baseUrl: "http://localhost:3000", shortLinks: true })
    const id = await boardWithItem(call)

    const { data } = await call("get_editor_link", { board_id: id })

    expect(data.url.startsWith("http://localhost:3000/create#tm=")).toBe(true)
    expect(decodePayload(data.url.split("#tm=")[1]).title).toBe("Games")
    expect(data.note).toMatch(reason)
    expect(data.note).toMatch(/nothing was saved/)
  })

  it("never contacts the site when short links are off", async () => {
    const posts: Post[] = []
    const fetch = draftFetch(() => new Response("{}", { status: 201 }), posts)
    const { call } = await connect({ fetch, baseUrl: "http://localhost:3000", shortLinks: false })
    const id = await boardWithItem(call)

    const { data } = await call("get_editor_link", { board_id: id })

    expect(data.url.startsWith("http://localhost:3000/create#tm=")).toBe(true)
    expect(data.note).toBeUndefined()
    expect(posts).toHaveLength(0)
  })

  it("reads TIERMAKER_SHORT_LINKS", () => {
    expect(resolveShortLinks({})).toBe(true)
    expect(resolveShortLinks({ TIERMAKER_SHORT_LINKS: "1" })).toBe(true)
    for (const off of ["0", "false", "OFF", " no "]) expect(resolveShortLinks({ TIERMAKER_SHORT_LINKS: off })).toBe(false)
  })
})
