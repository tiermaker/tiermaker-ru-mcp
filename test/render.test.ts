import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { addItems, BoardStore, placeItems } from "../src/board.js"
import { fetchImage, renderBoardPng, renderBoardSvg } from "../src/render.js"
import { connect, mockFetch, pngBytes, type Calls } from "./helpers.js"

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe("render_image", () => {
  it("renders a PNG with images, placeholders and an unplaced pool", async () => {
    const calls: Calls = []
    const { call, outputDir } = await connect({ fetch: mockFetch(calls) })
    const created = await call("create_tierlist", { title: "Привет, мир" })
    const id = created.data.board_id
    await call("add_items", {
      board_id: id,
      items: [
        { label: "ok", image_url: "https://img.example/ok.png" },
        { label: "Кириллица", image_url: "https://img.example/ok.png" },
        { label: "huge", image_url: "https://img.example/huge.png" },
        { label: "html", image_url: "https://img.example/page.html" },
        { label: "boom", image_url: "https://img.example/missing.png" },
        { label: "text only" },
        { label: "left in pool" },
      ],
    })
    await call("place_items", { board_id: id, placements: { S: ["i1", "i2"], A: ["i3", "i4", "i5", "i6"] } })
    const rendered = await call("render_image", { board_id: id })
    expect(rendered.isError).toBe(false)
    expect(rendered.data.path).toBe(`${outputDir}/privet-mir.png`.replace("privet-mir", "привет-мир"))
    expect(rendered.data.bytes).toBeGreaterThan(1000)
    const file = readFileSync(rendered.data.path)
    expect(file.subarray(0, 8).equals(SIGNATURE)).toBe(true)
    expect(file.byteLength).toBe(rendered.data.bytes)
    expect(rendered.content.some((part) => part.type === "image")).toBe(true)
    // the same URL is downloaded once
    expect(calls.filter((url) => url.endsWith("/ok.png"))).toHaveLength(1)
  })

  it("wraps long captions into at most three lines inside the card", async () => {
    const long = "Extraordinarily long caption that keeps going and going well past the end of any card in the grid"
    const unbroken = "Supercalifragilisticexpialidocious".repeat(3)
    const store = new BoardStore()
    const board = store.create("Wrap")
    addItems(board, [{ label: long }, { label: unbroken }, { label: long, image_url: "https://img.example/ok.png" }, { label: "Short" }])
    placeItems(board, { S: board.items.map((item) => item.id) })
    const svg = await renderBoardSvg(board, mockFetch(), false)
    const glyphs = [...svg.matchAll(/<text[^>]*?\sx="([\d.]+)"[^>]*?\sy="([\d.]+)"[^>]*?font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      size: Number(m[3]),
      text: m[4]!,
    }))
    // the first card (x 176..288) holds the long text-only caption: three lines at most, cut with an ellipsis, inside the card
    const first = glyphs.filter((glyph) => glyph.size === 16 && glyph.x >= 176 && glyph.x < 288)
    expect(new Set(first.map((glyph) => glyph.y)).size).toBe(3)
    expect(first.some((glyph) => glyph.text.includes("…"))).toBe(true)
    const caption = first.map((glyph) => glyph.text).join("")
    expect(caption.startsWith("Extraordinari")).toBe(true)
    expect(caption).not.toContain("grid")
    // a whole board with such captions still renders to a PNG
    const png = await renderBoardPng(board, mockFetch())
    expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true)
  })

  it("renders an empty board to a custom path", async () => {
    const { call, outputDir } = await connect()
    const id = (await call("create_tierlist", { title: "Empty" })).data.board_id
    const rendered = await call("render_image", { board_id: id, output_path: `${outputDir}/out/a.png` })
    expect(readFileSync(rendered.data.path).subarray(0, 8).equals(SIGNATURE)).toBe(true)
  })
})

describe("fetchImage limits", () => {
  const respond = (init: ResponseInit, body: BodyInit | null = pngBytes()) => (async () => new Response(body, init)) as unknown as typeof fetch

  it("accepts images and refuses everything else", async () => {
    expect(await fetchImage("https://x/a.png", respond({ headers: { "content-type": "image/png" } }))).toMatch(/^data:image\/png;base64,/)
    expect(await fetchImage("https://x/a", respond({ headers: { "content-type": "text/html" } }))).toBeUndefined()
    expect(await fetchImage("https://x/a", respond({ status: 500 }))).toBeUndefined()
    expect(await fetchImage("https://x/a", (async () => { throw new Error("net") }) as typeof fetch)).toBeUndefined()
  })

  it("refuses bodies over 5 MB even without content-length", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1)
    expect(await fetchImage("https://x/a.png", respond({ headers: { "content-type": "image/png" } }, big))).toBeUndefined()
  })

  it("passes a timeout signal", async () => {
    let signal: AbortSignal | null | undefined
    const spy = (async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal
      return new Response(Buffer.alloc(4), { headers: { "content-type": "image/png" } })
    }) as unknown as typeof fetch
    await fetchImage("https://x/a.png", spy)
    expect(signal).toBeDefined()
  })
})

it('renders WebP template photos as visible pixels rather than blank cards', async () => {
  const { Resvg } = await import('@resvg/resvg-js')
  const store = new BoardStore()
  const board = store.create('WebP')
  addItems(board,[{ label:'Photo',image_url:'https://images.example/red.webp' }])
  placeItems(board,{ S:['i1'] })
  const webp = readFileSync(new URL('./fixtures/red.webp',import.meta.url))
  const upstream = (async () => new Response(webp,{headers:{'content-type':'image/webp'}})) as typeof fetch
  const png = await renderBoardPng(board,upstream)
  const decoded = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><image href="data:image/png;base64,${png.toString('base64')}" width="1200" height="800" preserveAspectRatio="none"/></svg>`).render()
  const at=(100*1200+200)*4
  expect([...decoded.pixels.slice(at,at+4)]).toEqual([255,0,0,255])
})
