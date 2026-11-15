import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import satori from "satori"
import { imageSize } from "image-size"
import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"
import { USER_AGENT } from "./config.js"
import { WorkQueue } from "./limits.js"
import type { Board } from "./board.js"
import { poolItems } from "./board.js"
import type { Fetch } from "./catalog.js"

const imageDownloads = new WorkQueue(4, 200)
const IMAGE_TIMEOUT_MS = 8_000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const WIDTH = 1200
const LABEL_WIDTH = 160
const CELL = 112
const GAP = 6
const MAX_CAPTION_LINES = 3
const SUPPORTED_IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

const require = createRequire(import.meta.url)
let fonts: Array<{ name: string; data: Buffer; weight: 700; style: "normal" }> | undefined

function loadFonts() {
  fonts ??= [
    ["latin", "Inter"],
    ["cyrillic", "InterCyrillic"],
  ].map(([subset, name]) => ({
    name: name!,
    data: readFileSync(require.resolve(`@fontsource/inter/files/inter-${subset}-700-normal.woff`)),
    weight: 700 as const,
    style: "normal" as const,
  }))
  return fonts
}

/** Downloads an image into a data URI, or returns undefined (the caller draws a placeholder). */
export async function fetchImage(url: string, fetchImpl: Fetch = fetch, budget?: { bytes: number; pixels: number }): Promise<string | undefined> {
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    })
    if (!response.ok || !response.body) return undefined
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
    if (!SUPPORTED_IMAGES.includes(type)) return undefined
    const declared = Number(response.headers.get("content-length") ?? 0)
    if (declared > IMAGE_MAX_BYTES) return undefined
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength
      if (total > IMAGE_MAX_BYTES) return undefined
      if (budget) {
        budget.bytes += chunk.byteLength
        if (budget.bytes > 32 * 1024 * 1024) return undefined
      }
      chunks.push(chunk)
    }
    const data = Buffer.concat(chunks)
    const dimensions = imageSize(data)
    const detectedMime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" }
    if (!dimensions.type || detectedMime[dimensions.type] !== type) return undefined
    const pixels = dimensions.width * dimensions.height
    if (dimensions.width > 4096 || dimensions.height > 4096 || pixels > 4 * 1024 * 1024) return undefined
    if (budget) {
      if (budget.pixels + pixels > 16 * 1024 * 1024) return undefined
      budget.pixels += pixels
    }
    const normalized = await sharp(data, { limitInputPixels: 4 * 1024 * 1024, animated: false, pages: 1 })
      .rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).png().toBuffer()
    return `data:image/png;base64,${normalized.toString("base64")}`
  } catch {
    return undefined
  }
}

function isLight(color: string): boolean {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]
  if (!hex) return false
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}

type Node = { type: string; props: Record<string, unknown> }
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style: { display: "flex", ...style }, ...(children === undefined ? {} : { children }), ...extra },
})

function card(label: string | undefined, image: string | undefined, wantedImage: boolean): Node {
  const box = { width: CELL, height: CELL, margin: GAP / 2, position: "relative", overflow: "hidden", borderRadius: 8 }
  const caption = label
    ? el(
        "div",
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "3px 4px",
          fontSize: 14,
          lineHeight: 1.15,
          color: "#fff",
          background: image ? "rgba(0,0,0,0.65)" : "transparent",
          justifyContent: "center",
          textAlign: "center",
          ...(image ? {} : { top: 0, alignItems: "center", fontSize: label.length > 40 ? 16 : 20 }),
        },
        // the text sits in its own element: satori applies lineClamp only to a plain text container
        el("div", { display: "block", maxWidth: "100%", wordBreak: "break-word", lineClamp: MAX_CAPTION_LINES, textAlign: "center" }, label),
      )
    : undefined
  if (image) {
    return el("div", { ...box, background: "#1f2937" }, [
      el("img", { width: CELL, height: CELL, objectFit: "cover" }, undefined, { src: image, width: CELL, height: CELL }),
      ...(caption ? [caption] : []),
    ])
  }
  return el("div", { ...box, background: wantedImage ? "#4b5563" : "#374151" }, [
    ...(caption ? [caption] : [el("div", { margin: "auto", fontSize: 14, color: "#d1d5db" }, "no image")]),
  ])
}

/** Draws the board as SVG. `embedFont: false` keeps text as <text> elements (used by tests). */
export async function renderBoardSvg(board: Board, fetchImpl: Fetch = fetch, embedFont = true): Promise<string> {
  const urls = [...new Set(board.items.map((item) => item.imageUrl).filter((url): url is string => Boolean(url)))]
  const images = new Map<string, string | undefined>()
  const budget = { bytes: 0, pixels: 0 }
  const deadline = Date.now() + 30000
  await Promise.all(urls.map(url => imageDownloads.run(async () => { images.set(url, Date.now() >= deadline ? undefined : await fetchImage(url, fetchImpl, budget)) })))
  const byId = new Map(board.items.map((item) => [item.id, item]))
  const cardFor = (id: string) => {
    const item = byId.get(id)!
    return card(item.label, item.imageUrl ? images.get(item.imageUrl) : undefined, Boolean(item.imageUrl))
  }

  const INNER = WIDTH - 24
  const perRow = Math.floor((INNER - LABEL_WIDTH - 4) / (CELL + GAP))

  const tierRows = board.tiers.map((tier) => {
    const ids = board.placements[tier.id] ?? []
    const lines = Math.max(1, Math.ceil(ids.length / perRow))
    return el(
      "div",
      { width: INNER, minHeight: CELL + GAP, marginBottom: 4, background: "#111827" },
      [
        el(
          "div",
          {
            width: LABEL_WIDTH,
            minHeight: lines * (CELL + GAP),
            background: tier.color,
            color: isLight(tier.color) ? "#111827" : "#fff",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
            fontSize: tier.label.length > 10 ? 20 : 34,
            textAlign: "center",
            overflow: "hidden",
          },
          tier.label,
        ),
        el("div", { flex: 1, flexWrap: "wrap", padding: 2, alignContent: "flex-start" }, ids.map(cardFor)),
      ],
    )
  })

  const pool = poolItems(board)
  const children: Node[] = [
    el("div", { fontSize: 36, color: "#f9fafb", padding: "16px 8px 14px" }, board.title),
    ...tierRows,
    ...(pool.length
      ? [
          el("div", { fontSize: 18, color: "#9ca3af", padding: "12px 8px 4px" }, `Unplaced (${pool.length})`),
          el("div", { width: INNER, flexWrap: "wrap", padding: 2 }, pool.map((item) => cardFor(item.id))),
        ]
      : []),
  ]

  const poolLines = Math.ceil(pool.length / Math.floor((INNER - 4) / (CELL + GAP)))
  const height =
    70 +
    board.tiers.reduce(
      (sum, tier) => sum + Math.max(1, Math.ceil((board.placements[tier.id]?.length ?? 0) / perRow)) * (CELL + GAP) + 4,
      0,
    ) +
    (pool.length ? 40 + poolLines * (CELL + GAP) : 0)

  const root = el("div", { flexDirection: "column", width: WIDTH, height: height + 24, padding: 12, background: "#030712", fontFamily: "Inter, InterCyrillic" }, children)
  return satori(root as never, { width: WIDTH, height: height + 24, fonts: loadFonts(), embedFont })
}

export async function renderBoardPng(board: Board, fetchImpl: Fetch = fetch): Promise<Buffer> {
  const svg = await renderBoardSvg(board, fetchImpl)
  return Buffer.from(new Resvg(svg).render().asPng())
}
