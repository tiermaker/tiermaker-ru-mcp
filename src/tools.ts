import { mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  BoardStore,
  addItems,
  details,
  moveItem,
  placeItems,
  removeItems,
  removeTier,
  setTiers,
  summary,
  toImport,
  updateItem,
  updateTier,
  type Board,
} from "./board.js"
import { Catalog, templateItems, type Fetch } from "./catalog.js"
import { buildEditorLink, encodePayload, payloadSize, saveDraft } from "./codec.js"
import { VERSION } from "./config.js"
import { IMAGE_SOURCES, IMAGE_TOPICS, createImageSearch, type ImageSearcher } from "./images.js"
import type { NetOptions } from "./image-net.js"
import { renderBoardPng } from "./render.js"
import { BoardError, MAX_COMPRESSED_BYTES, MAX_ITEMS, MAX_TEXT_LENGTH, MAX_TIERS } from "./schema.js"

export type Deps = {
  remote?: { publish: (boardId: string, data: Buffer, mime: string) => string; render: (board: Board) => Promise<Buffer> }
  onTool?: (name: string, error: boolean, durationMs: number) => void
  imageSearch?: ImageSearcher
  baseUrl: string
  fetch?: Fetch
  store?: BoardStore
  /** Save boards on the site and return `/s/<id>` links (long `#tm=` link when saving fails). Off unless set. */
  shortLinks?: boolean
  /** Directory for files written without an explicit path. */
  outputDir?: string
  /** Request pacing for image sources (tests turn the waits off). */
  images?: Pick<NetOptions, "wait" | "now" | "gapMs">
}

const boardId = z.string().max(128).describe("Board id returned by create_tierlist")
const tierInput = z.object({
  id: z.string().optional().describe("Keep an existing tier id to preserve its items; omit for a new tier"),
  label: z.string().describe(`Tier name, up to ${MAX_TEXT_LENGTH} characters`),
  color: z.string().optional().describe('CSS color, e.g. "#ef4444"'),
})
const itemInput = z.object({
  label: z.string().optional().describe("Text shown on the card"),
  image_url: z.string().optional().describe("Direct http(s) link to an image"),
})

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "tierlist"
}

type ToolResult = { structuredContent?: Record<string, unknown>; content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean }

const LINK_LABEL = "Открыть в редакторе"

function ok(data: unknown): ToolResult {
  return { structuredContent: data as Record<string, unknown>, content: [{ type: "text" as const, text: JSON.stringify(data) }] }
}

function failure(error: unknown): ToolResult {
  const message = error instanceof BoardError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
  return { isError: true, content: [{ type: "text" as const, text: message }] }
}

function safely<A extends unknown[]>(handler: (...args: A) => ToolResult | Promise<ToolResult>) {
  return async (...args: A): Promise<ToolResult> => {
    try {
      return await handler(...args)
    } catch (error) {
      return failure(error)
    }
  }
}

function writeFile(path: string, data: string | Buffer): string {
  const full = resolve(path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, data)
  return full
}

export function createServer(deps: Deps): McpServer {
  const store = deps.store ?? new BoardStore()
  const catalog = new Catalog(deps.baseUrl, deps.fetch)
  const outputDir = deps.outputDir ?? process.cwd()
  const imageSearch = deps.imageSearch ?? createImageSearch({ fetch: deps.fetch, ...deps.images })
  const server = new McpServer({ name: "TierMaker.ru", version: VERSION })
  const mutations = new Set(["set_tiers", "update_tier", "remove_tier", "add_items", "update_item", "remove_items", "place_items", "move_item"])
  function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>) {
    const readOnly = !mutations.has(name) && !["create_tierlist", "get_editor_link"].includes(name)
    const inputSchema = z.object(shape).strict()
    server.registerTool<z.ZodRawShape, typeof inputSchema>(name, {
      title: name.split("_").map(word => word[0]!.toUpperCase() + word.slice(1)).join(" "),
      description,
      inputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: name.startsWith("remove_") || name === "set_tiers", idempotentHint: readOnly && !["render_image", "get_editor_link", "export_json"].includes(name), openWorldHint: ["search_images", "search_templates", "get_template", "list_categories", "render_image", "get_editor_link"].includes(name) },
    }, async args => {
      const started = Date.now()
      const result = await handler(args)
      deps.onTool?.(name, Boolean(result.isError), Date.now() - started)
      if (deps.remote && result.isError && result.content.some(part => part.type === "text" && part.text.startsWith("Unexpected error:"))) {
        return { isError: true, content: [{ type: "text", text: "The operation could not be completed. Try again shortly; existing boards are saved." }] }
      }
      return result
    })
  }
  const renderedPngs = new Map<string, string>()

  tool(
    "search_templates",
    "Search published TierMaker templates by text. Returns slugs usable with get_template and create_tierlist.",
    { query: z.string().max(256), category: z.string().optional().describe("Category slug from list_categories"), limit: z.number().int().min(1).max(50).optional() },
    safely(async ({ query, category, limit }) => ok({ templates: await catalog.search(query, category, limit ?? 10) })),
  )

  tool(
    "get_template",
    "Get a template with its items (names and image URLs).",
    { slug: z.string().max(160) },
    safely(async ({ slug }) => ok(await catalog.getTemplate(slug))),
  )

  tool("list_categories", "List template categories.", {}, safely(async () => ok({ categories: await catalog.listCategories() })))

  tool(
    "search_images",
    "Find pictures for cards. Returns direct image URLs (at most 512 px) with title, source, page_url and either license (free files) or rights (copyrighted artwork used by reference), plus attribution; pass a url to add_items as image_url. source: auto (default; picks by topic, falls back to commons), commons (photos), wikidata (named people, places, brands, logos), pokeapi (Pokémon official artwork by name), anilist (anime/manga covers, characters), coverart (album covers), openlibrary (book covers). topic is a hint for auto.",
    {
      query: z.string().max(256),
      source: z.enum(IMAGE_SOURCES).optional(),
      topic: z.enum(IMAGE_TOPICS).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    safely(async ({ query, source, topic, limit }) => ok(await imageSearch(query, { source, topic, limit: limit ?? 5 }))),
  )

  tool(
    "create_tierlist",
    `Create a board; in remote mode it is kept for seven days after the last edit. Without tiers you get S/A/B/C/D. With template_slug the template's items go to the unplaced pool. Limits: ${MAX_TIERS} tiers, ${MAX_ITEMS} items.`,
    { title: z.string(), tiers: z.array(tierInput).max(MAX_TIERS).optional(), template_slug: z.string().max(160).optional() },
    safely(async ({ title, tiers, template_slug }) => {
      const template = template_slug ? await catalog.getTemplate(template_slug) : undefined
      const board = store.create(title, tiers)
      let skipped = 0
      if (template) {
        const found = templateItems(template)
        addItems(board, found.items)
        board.templateSlug = template.slug
        skipped = found.skipped
      }
      store.save(board)
      return ok({ ...summary(board), ...(skipped ? { skipped_template_items: skipped } : {}) })
    }),
  )

  tool(
    "set_tiers",
    "Replace the whole tier list (names, colors, order). Tiers that keep their id keep their items; items of dropped tiers return to the pool.",
    { board_id: boardId, tiers: z.array(tierInput).max(MAX_TIERS) },
    safely(({ board_id, tiers }) => store.transaction(() => {
      const board = store.get(board_id)
      setTiers(board, tiers)
      return ok(summary(board))
    })),
  )

  tool(
    "update_tier",
    "Change a tier's label, color or position (0 = top).",
    { board_id: boardId, tier_id: z.string(), label: z.string().optional(), color: z.string().optional(), position: z.number().int().min(0).optional() },
    safely(({ board_id, tier_id, ...patch }) => store.transaction(() => {
      const board = store.get(board_id)
      updateTier(board, tier_id, patch)
      return ok(summary(board))
    })),
  )

  tool(
    "remove_tier",
    "Remove a tier; its items go back to the pool.",
    { board_id: boardId, tier_id: z.string() },
    safely(({ board_id, tier_id }) => store.transaction(() => {
      const board = store.get(board_id)
      removeTier(board, tier_id)
      return ok(summary(board))
    })),
  )

  tool(
    "add_items",
    `Add cards to the pool. Each needs a label, an image_url, or both. Board limit: ${MAX_ITEMS} items.`,
    { board_id: boardId, items: z.array(itemInput).min(1).max(MAX_ITEMS) },
    safely(({ board_id, items }) => store.transaction(() => {
      const board = store.get(board_id)
      const added = addItems(board, items)
      return ok({ ...summary(board), added_item_ids: added.map((item) => item.id) })
    })),
  )

  tool(
    "update_item",
    "Change an item's label or image_url (null removes it; one of them must remain).",
    { board_id: boardId, item_id: z.string(), label: z.string().nullable().optional(), image_url: z.string().nullable().optional() },
    safely(({ board_id, item_id, ...patch }) => store.transaction(() => {
      const board = store.get(board_id)
      updateItem(board, item_id, patch)
      return ok(summary(board))
    })),
  )

  tool(
    "remove_items",
    "Delete items from the board.",
    { board_id: boardId, item_ids: z.array(z.string()).min(1) },
    safely(({ board_id, item_ids }) => store.transaction(() => {
      const board = store.get(board_id)
      removeItems(board, item_ids)
      return ok(summary(board))
    })),
  )

  tool(
    "place_items",
    "Set the contents of the listed tiers: {tier_id: [item_ids]}, order = array order. Items listed in a tier leave their previous place; tiers not mentioned are untouched; items left out of a listed tier return to the pool.",
    { board_id: boardId, placements: z.record(z.string(), z.array(z.string())) },
    safely(({ board_id, placements }) => store.transaction(() => {
      const board = store.get(board_id)
      placeItems(board, placements)
      return ok(summary(board))
    })),
  )

  tool(
    "move_item",
    'Move one item to a tier id or to "pool", optionally at a position (0 = first).',
    { board_id: boardId, item_id: z.string(), tier_id: z.string().describe('Tier id or "pool"'), position: z.number().int().min(0).optional() },
    safely(({ board_id, item_id, tier_id, position }) => store.transaction(() => {
      const board = store.get(board_id)
      moveItem(board, item_id, tier_id, position)
      return ok(summary(board))
    })),
  )

  tool(
    "get_tierlist",
    "Current board: tiers with item ids, pool, and all items. Use it to double-check before rendering.",
    { board_id: boardId },
    safely(({ board_id }) => ok(details(store.get(board_id)))),
  )

  tool(
    "render_image",
    "Render the board as PNG. Remote mode returns an image and a download URL valid for 24 hours. Unavailable images show placeholders.",
    { board_id: boardId, ...(deps.remote ? {} : { output_path: z.string().optional() }) },
    safely(async ({ board_id, output_path }) => {
      const board = store.get(board_id)
      const png = await (deps.remote ? deps.remote.render(board) : renderBoardPng(board, deps.fetch))
      if (deps.remote) {
        const data = { download_url: deps.remote.publish(board.id, png, "image/png"), bytes: png.byteLength, expires_in_seconds: 86400 }
        const result = ok(data)
        result.content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" })
        return result
      }
      const path = writeFile(typeof output_path === "string" ? output_path : join(outputDir, `${slugify(board.title)}.png`), png)
      renderedPngs.set(board.id, path)
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ path, bytes: png.byteLength }) },
          { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
        ],
      }
    }),
  )

  tool(
    "get_editor_link",
    deps.remote ? "Open this board in the TierMaker.ru editor. This sends the board to the site for a link retained 180 days; anyone with the link can open it. If saving is unavailable, returns a full #tm= link. Oversized boards return downloadable JSON for manual import." : "Link that opens the board in the TierMaker editor as a local draft. By default the board is saved on the site for 180 days and the link is short (`/s/<id>`, openable by anyone who has it); if saving fails you get the full `#tm=` link and a `note`. Returns `markdown`, a ready `[Открыть в редакторе](url)` line to paste into the answer as is (never retype the url), and writes the url to `link_file` (<title>.link.txt next to the PNG). If the board is too big for a link, a .tierlist.json file is written instead.",
    { board_id: boardId },
    safely(async ({ board_id }) => {
      const board = store.get(board_id)
      const payload = toImport(board)
      if (payloadSize(payload) <= MAX_COMPRESSED_BYTES) {
        const encoded = encodePayload(payload)
        let url = buildEditorLink(deps.baseUrl, encoded)
        let note: string | undefined
        let expires_at: string | undefined
        if (deps.shortLinks) {
          const saved = await saveDraft(deps.baseUrl, encoded, deps.fetch)
          if (saved.ok) {
            url = saved.draft.url
            expires_at = saved.draft.expiresAt
          } else {
            note = `Short link unavailable (${saved.reason}); this is the full link, nothing was saved on the site.`
          }
        }
        const markdown = `[${LINK_LABEL}](${url})`
        if (deps.remote) return ok({ url, markdown, ...(expires_at ? { expires_at } : {}), ...(note ? { note } : {}) })
        const png = renderedPngs.get(board.id)
        const linkPath = png ? png.replace(/\.png$/i, "") + ".link.txt" : join(outputDir, `${slugify(board.title)}.link.txt`)
        const link_file = writeFile(linkPath, `${url}\n`)
        return ok({ url, markdown, link_file, ...(expires_at ? { expires_at } : {}), ...(note ? { note } : {}) })
      }
      if (deps.remote) return ok({ download_url: deps.remote.publish(board.id, Buffer.from(JSON.stringify(payload, null, 2)), "application/json"), expires_in_seconds: 86400, instructions: `Open ${deps.baseUrl}/create and use Импорт из файла (import from file) with the downloaded JSON.` })
      const path = writeFile(join(outputDir, `${slugify(board.title)}.tierlist.json`), JSON.stringify(payload, null, 2))
      return ok({
        file: path,
        instructions: `The board is too large for a link. Open ${deps.baseUrl}/create and use "Импорт из файла" (import from file) with ${basename(path)}.`,
      })
    }),
  )

  tool(
    "export_json",
    "Export TierListImport v1 JSON for import in the editor. Remote downloads last 24 hours.",
    { board_id: boardId, ...(deps.remote ? {} : { output_path: z.string().optional() }) },
    safely(({ board_id, output_path }) => {
      const board: Board = store.get(board_id)
      if (deps.remote) return ok({ download_url: deps.remote.publish(board.id, Buffer.from(JSON.stringify(toImport(board), null, 2)), "application/json"), expires_in_seconds: 86400 })
      const path = writeFile(typeof output_path === "string" ? output_path : join(outputDir, `${slugify(board.title)}.tierlist.json`), JSON.stringify(toImport(board), null, 2))
      return ok({ file: path })
    }),
  )

  return server
}
