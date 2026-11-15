export const FORMAT_VERSION = 1
export const MAX_TIERS = 20
export const MAX_ITEMS = 200
export const MAX_COMPRESSED_BYTES = 32 * 1024
export const MAX_UNCOMPRESSED_BYTES = 512 * 1024
export const MAX_TEXT_LENGTH = 128
export const MAX_ID_LENGTH = 128
export const MAX_COLOR_LENGTH = 64
export const MAX_TEMPLATE_SLUG_LENGTH = 160

export type TierListImport = {
  version: 1
  title: string
  templateSlug?: string
  tiers: Array<{ id: string; label: string; color: string }>
  items: Array<{ id: string; label?: string; imageUrl?: string }>
  placements: Record<string, string[]>
}

/** Error with a message that is safe and useful to show to the agent. */
export class BoardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BoardError"
  }
}

export function fail(message: string): never {
  throw new BoardError(message)
}

// Colors the editor understands (mirrors `isCssTierColor` / `resolveTierColor` of the site).
const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ef4444", orange: "#f97316", yellow: "#eab308", gold: "#fbbf24",
  green: "#22c55e", lime: "#84cc16", teal: "#14b8a6", cyan: "#06b6d4", blue: "#3b82f6", navy: "#1e3a8a",
  indigo: "#6366f1", purple: "#9333ea", violet: "#8b5cf6", pink: "#ec4899", magenta: "#d946ef", brown: "#92400e",
  gray: "#6b7280", grey: "#6b7280", silver: "#cbd5e1",
}

const TAILWIND_COLORS: Record<string, string> = {
  "bg-red-600": "#dc2626", "bg-orange-500": "#f97316", "bg-yellow-500": "#eab308", "bg-green-500": "#22c55e",
  "bg-green-600": "#16a34a", "bg-blue-500": "#3b82f6", "bg-indigo-500": "#6366f1", "bg-purple-600": "#9333ea",
  "bg-pink-500": "#ec4899", "bg-rose-600": "#e11d48", "bg-emerald-600": "#059669", "bg-lime-600": "#65a30d",
  "bg-amber-500": "#f59e0b", "bg-slate-500": "#64748b", "bg-slate-600": "#475569",
}

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/
const PERCENT = /^-?(?:\d+(?:\.\d+)?|\.\d+)%$/

function functionalParts(body: string): { channels: string[]; alpha?: string; comma: boolean } | null {
  if (body.includes(",")) {
    if (body.includes("/")) return null
    const parts = body.split(",").map((part) => part.trim())
    if (parts.length < 3 || parts.length > 4 || parts.some((part) => !part || /\s/.test(part))) return null
    return { channels: parts.slice(0, 3), alpha: parts[3], comma: true }
  }
  const portions = body.split("/")
  if (portions.length > 2) return null
  const channels = portions[0]!.trim().split(/\s+/)
  const alpha = portions[1]?.trim()
  if (channels.length !== 3 || (alpha !== undefined && (!alpha || /\s/.test(alpha)))) return null
  return { channels, alpha, comma: false }
}

/** Same accepted syntax as the editor: #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), hsl()/hsla(). */
function isEditorColor(value: string): boolean {
  const color = value.trim().toLowerCase()
  if (color.startsWith("#")) return [3, 4, 6, 8].includes(color.length - 1) && /^[0-9a-f]+$/.test(color.slice(1))
  const match = color.match(/^(rgba?|hsla?)\((.*)\)$/)
  if (!match) return false
  const parts = functionalParts(match[2]!)
  if (!parts) return false
  if (parts.alpha !== undefined && !NUMBER.test(parts.alpha) && !PERCENT.test(parts.alpha)) return false
  if (match[1]!.startsWith("rgb")) {
    if (parts.channels.some((part) => !NUMBER.test(part) && !PERCENT.test(part))) return false
    return !(parts.comma && parts.channels.some((part) => part.endsWith("%") !== parts.channels[0]!.endsWith("%")))
  }
  const [hue, saturation, lightness] = parts.channels as [string, string, string]
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn)?$/.test(hue) && PERCENT.test(saturation) && PERCENT.test(lightness)
}

/** Returns a color the editor shows as-is; names and site color classes are converted to hex. */
export function assertColor(color: string): string {
  const value = color.trim()
  const key = value.toLowerCase()
  const known = NAMED_COLORS[key] ?? TAILWIND_COLORS[key]
  if (known) return known
  if (!value || value.length > MAX_COLOR_LENGTH || !isEditorColor(value)) {
    fail(
      `Unsupported color "${color}". Use hex ("#ef4444"), rgb(), hsl(), or one of: ${Object.keys(NAMED_COLORS).join(", ")}.`,
    )
  }
  return value
}

export function assertText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string.`)
  if (value.length > MAX_TEXT_LENGTH) fail(`${field} is longer than ${MAX_TEXT_LENGTH} characters.`)
  return value
}

export function assertImageUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("image_url must be a non-empty string.")
  if (value.length > 2048) fail("Image URL is too long (limit 2048 characters).")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return fail(`image_url "${value}" is not an absolute URL.`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(`image_url must use http or https (got "${url.protocol}").`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) fail(`Invalid ${field}.`)
  if (value.length > max) fail(`${field} is too long.`)
  return value
}

/** Same rules as `validateTierListImport` on the TierMaker site (format v1). */
export function validateTierListImport(value: unknown): TierListImport {
  if (!isRecord(value) || !onlyKeys(value, ["version", "title", "templateSlug", "tiers", "items", "placements"])) {
    fail("Board has an unsupported format.")
  }
  if (value.version !== FORMAT_VERSION) fail("Board version is not supported.")
  const title = requiredString(value.title, "title", MAX_TEXT_LENGTH)
  const templateSlug =
    value.templateSlug === undefined ? undefined : requiredString(value.templateSlug, "template slug", MAX_TEMPLATE_SLUG_LENGTH)

  if (!Array.isArray(value.tiers) || value.tiers.length > MAX_TIERS) {
    fail(`A board can have at most ${MAX_TIERS} tiers.`)
  }
  const tierIds = new Set<string>()
  const tiers = value.tiers.map((tier: unknown) => {
    if (!isRecord(tier) || !onlyKeys(tier, ["id", "label", "color"])) fail("Invalid tier.")
    const id = requiredString(tier.id, "tier id", MAX_ID_LENGTH)
    if (tierIds.has(id)) fail(`Duplicate tier id "${id}".`)
    tierIds.add(id)
    return {
      id,
      label: requiredString(tier.label, "tier label", MAX_TEXT_LENGTH),
      color: requiredString(tier.color, "tier color", MAX_COLOR_LENGTH),
    }
  })

  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS) {
    fail(`A board can have at most ${MAX_ITEMS} items.`)
  }
  const itemIds = new Set<string>()
  const items = value.items.map((item: unknown) => {
    if (!isRecord(item) || !onlyKeys(item, ["id", "label", "imageUrl"])) fail("Invalid item.")
    const id = requiredString(item.id, "item id", MAX_ID_LENGTH)
    if (itemIds.has(id)) fail(`Duplicate item id "${id}".`)
    itemIds.add(id)
    const label = item.label === undefined ? undefined : requiredString(item.label, "item label", MAX_TEXT_LENGTH)
    const imageUrl = item.imageUrl === undefined ? undefined : assertImageUrl(item.imageUrl)
    if (!label && !imageUrl) fail(`Item "${id}" needs a label or an image_url.`)
    return { id, ...(label ? { label } : {}), ...(imageUrl ? { imageUrl } : {}) }
  })

  if (!isRecord(value.placements)) fail("Invalid placements.")
  const placements: Record<string, string[]> = {}
  const placed = new Set<string>()
  for (const [tierId, list] of Object.entries(value.placements)) {
    if (!tierIds.has(tierId)) fail(`Placements reference unknown tier "${tierId}".`)
    if (!Array.isArray(list) || list.some((id) => typeof id !== "string")) fail("Invalid placements.")
    placements[tierId] = list as string[]
    for (const itemId of list as string[]) {
      if (!itemIds.has(itemId)) fail(`Placements reference unknown item "${itemId}".`)
      if (placed.has(itemId)) fail(`Item "${itemId}" is placed more than once.`)
      placed.add(itemId)
    }
  }

  return { version: 1, title, ...(templateSlug ? { templateSlug } : {}), tiers, items, placements }
}
