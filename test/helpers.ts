import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Resvg } from "@resvg/resvg-js"
import { createServer } from "../src/tools.js"

export const BASE = "https://tiermaker.example"

export function pngBytes(color = "#3b82f6"): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`
  return Buffer.from(new Resvg(svg).render().asPng())
}

const TEMPLATE = {
  id: 1,
  title: "Fruits",
  slug: "fruits",
  description: "Rate fruits",
  tags: ["food"],
  itemCount: 3,
  category: { id: 1, name: "Food", slug: "food" },
  items: [
    { name: "Apple", image: { filePath: "https://img.example/apple.png" } },
    { name: "Pear", image: { filePath: "/api/media/pear.png" } },
    { name: "Plum", image: null },
  ],
}

export type Calls = string[]

/** Fetch mock: catalog JSON on the base host, a PNG for img.example/ok.png, failures elsewhere. */
export function mockFetch(calls: Calls = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    if (url.startsWith("https://commons.wikimedia.org/w/api.php")) {
      const query = new URL(url).searchParams.get("gsrsearch") ?? ""
      if (query.startsWith("broken")) return json({ error: "x" }, 500)
      const info = (name: string, mime: string, extra: Record<string, unknown> = {}) => ({
        title: `File:${name}`,
        index: 0,
        imageinfo: [
          {
            thumburl: `https://upload.wikimedia.org/thumb/${name}/500px-${name}?utm_source=commons`,
            thumbwidth: 500,
            url: `https://upload.wikimedia.org/${name}`,
            mime,
            descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
            extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: '<a href="//x">Ann &amp; Bob</a>' } },
            ...extra,
          },
        ],
      })
      return json({
        query: {
          pages: {
            "3": { ...info("Third.jpg", "image/jpeg"), index: 3 },
            "1": { ...info("First_car.jpg", "image/jpeg"), index: 1 },
            "2": { ...info("Logo.svg", "image/svg+xml"), index: 2 },
            "4": { ...info("Doc.pdf", "application/pdf"), index: 4 },
            "5": { ...info("Plain.png", "image/png", { extmetadata: {} }), index: 5 },
            "6": { ...info("Big.jpg", "image/jpeg", { thumburl: "https://upload.wikimedia.org/thumb/Big.jpg/960px-Big.jpg", thumbwidth: 512 }), index: 6 },
            "7": { ...info("Wide.jpg", "image/jpeg", { thumburl: "https://upload.wikimedia.org/thumb/Wide.jpg/500px-Wide.jpg", thumbwidth: 900 }), index: 7 },
            "8": { ...info("Original.jpg", "image/jpeg", { thumburl: "https://upload.wikimedia.org/Original.jpg", thumbwidth: undefined }), index: 8 },
          },
        },
      })
    }
    if (url.startsWith(`${BASE}/api/templates/catalog/`)) return json({ items: [TEMPLATE, { ...TEMPLATE, slug: "other" }] })
    if (url === `${BASE}/api/templates/slug/fruits/`) return json(TEMPLATE)
    if (url.startsWith(`${BASE}/api/templates/slug/`)) return json({ detail: "nope" }, 404)
    if (url === `${BASE}/api/categories/`) return json({ items: [{ slug: "food", name: "Food", description: "", templateCount: 4 }] })
    if (url.endsWith("/ok.png") || url.endsWith("/apple.png") || url.endsWith("/pear.png")) {
      return new Response(pngBytes(), { status: 200, headers: { "content-type": "image/png" } })
    }
    if (url.endsWith("/huge.png")) {
      return new Response(Buffer.alloc(10), { status: 200, headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) } })
    }
    if (url.endsWith("/page.html")) return new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })
    throw new Error(`unexpected request: ${url}`)
  }) as typeof fetch
}

export async function connect(options: { fetch?: typeof fetch; baseUrl?: string; shortLinks?: boolean } = {}) {
  const outputDir = mkdtempSync(join(tmpdir(), "tiermaker-mcp-"))
  const server = createServer({ baseUrl: options.baseUrl ?? BASE, fetch: options.fetch ?? mockFetch(), outputDir, shortLinks: options.shortLinks, images: { wait: async () => {}, gapMs: 0 } })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
      content: Array<{ type: string; text?: string; data?: string }>
    }
    const text = result.content.find((part) => part.type === "text")?.text ?? ""
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
    return { isError: Boolean(result.isError), text, data, content: result.content }
  }
  return { client, call, outputDir }
}
