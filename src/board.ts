import { randomUUID } from "node:crypto"
import {
  MAX_ITEMS,
  MAX_TIERS,
  assertColor,
  assertImageUrl,
  assertText,
  fail,
  validateTierListImport,
  type TierListImport,
} from "./schema.js"

export type Tier = { id: string; label: string; color: string }
export type Item = { id: string; label?: string; imageUrl?: string }
export type Board = {
  id: string
  title: string
  templateSlug?: string
  tiers: Tier[]
  items: Item[]
  placements: Record<string, string[]>
  nextItem: number
  nextTier: number
}

export type TierInput = { id?: string; label: string; color?: string }
export type ItemInput = { label?: string; image_url?: string }

export const DEFAULT_TIERS: Tier[] = [
  { id: "S", label: "S", color: "#dc2626" },
  { id: "A", label: "A", color: "#f97316" },
  { id: "B", label: "B", color: "#eab308" },
  { id: "C", label: "C", color: "#22c55e" },
  { id: "D", label: "D", color: "#3b82f6" },
]

const PALETTE = ["#dc2626", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#6366f1", "#9333ea", "#ec4899"]

export class BoardStore {
  protected boards = new Map<string, Board>()

  save(board: Board): void { this.boards.set(board.id, board) }
  transaction<T>(fn: () => T): T { return fn() }

  create(title: string, tiers?: TierInput[]): Board {
    const board: Board = {
      id: randomUUID().slice(0, 8),
      title: assertText(title, "title"),
      tiers: [],
      items: [],
      placements: {},
      nextItem: 1,
      nextTier: 1,
    }
    if (tiers && tiers.length > 0) setTiers(board, tiers)
    else board.tiers = DEFAULT_TIERS.map((tier) => ({ ...tier }))
    for (const tier of board.tiers) board.placements[tier.id] = []
    this.boards.set(board.id, board)
    return board
  }

  get(id: string): Board {
    const board = this.boards.get(id)
    if (!board) fail(`Board "${id}" not found. Boards live only while the server runs; create a new one with create_tierlist.`)
    return board
  }
}

function tierColor(index: number): string {
  return PALETTE[index % PALETTE.length]!
}

export function setTiers(board: Board, inputs: TierInput[]): void {
  if (inputs.length > MAX_TIERS) fail(`A board can have at most ${MAX_TIERS} tiers (got ${inputs.length}).`)
  const known = new Map(board.tiers.map((tier) => [tier.id, tier]))
  const seen = new Set<string>()
  const next: Tier[] = inputs.map((input, index) => {
    const label = assertText(input.label, "Tier label")
    let id = input.id
    if (id !== undefined) {
      assertText(id, "Tier id")
      if (seen.has(id)) fail(`Duplicate tier id "${id}".`)
    } else {
      do id = `t${board.nextTier++}`
      while (seen.has(id) || known.has(id))
    }
    seen.add(id)
    const color = input.color !== undefined ? assertColor(input.color) : (known.get(id)?.color ?? tierColor(index))
    return { id, label, color }
  })
  const placements: Record<string, string[]> = {}
  for (const tier of next) placements[tier.id] = board.placements[tier.id] ?? []
  board.tiers = next
  board.placements = placements
}

export function updateTier(
  board: Board,
  tierId: string,
  patch: { label?: string; color?: string; position?: number },
): void {
  const index = findTier(board, tierId)
  const tier = { ...board.tiers[index]! }
  if (patch.label !== undefined) tier.label = assertText(patch.label, "Tier label")
  if (patch.color !== undefined) tier.color = assertColor(patch.color)
  const tiers = board.tiers.filter((_, i) => i !== index)
  const position = patch.position === undefined ? index : Math.max(0, Math.min(patch.position, tiers.length))
  tiers.splice(position, 0, tier)
  board.tiers = tiers
}

export function removeTier(board: Board, tierId: string): number {
  findTier(board, tierId)
  const returned = board.placements[tierId]?.length ?? 0
  board.tiers = board.tiers.filter((tier) => tier.id !== tierId)
  delete board.placements[tierId]
  return returned
}

function findTier(board: Board, tierId: string): number {
  const index = board.tiers.findIndex((tier) => tier.id === tierId)
  if (index < 0) fail(`Unknown tier "${tierId}". Tiers: ${board.tiers.map((t) => t.id).join(", ") || "(none)"}.`)
  return index
}

function checkItem(item: ItemInput, where: string): { label?: string; imageUrl?: string } {
  const label = item.label === undefined ? undefined : assertText(item.label, `${where} label`)
  const imageUrl = item.image_url === undefined ? undefined : assertImageUrl(item.image_url)
  if (!label && !imageUrl) fail(`${where} needs a label or an image_url.`)
  return { ...(label ? { label } : {}), ...(imageUrl ? { imageUrl } : {}) }
}

export function addItems(board: Board, inputs: ItemInput[]): Item[] {
  if (board.items.length + inputs.length > MAX_ITEMS) {
    fail(`A board can have at most ${MAX_ITEMS} items (have ${board.items.length}, adding ${inputs.length}).`)
  }
  const checked = inputs.map((input, index) => checkItem(input, `Item #${index + 1}`))
  const added = checked.map((item) => ({ id: `i${board.nextItem++}`, ...item }))
  board.items.push(...added)
  return added
}

export function updateItem(board: Board, itemId: string, patch: { label?: string | null; image_url?: string | null }): void {
  const item = findItem(board, itemId)
  const label = patch.label === undefined ? item.label : patch.label === null ? undefined : assertText(patch.label, "Item label")
  const imageUrl =
    patch.image_url === undefined ? item.imageUrl : patch.image_url === null ? undefined : assertImageUrl(patch.image_url)
  if (!label && !imageUrl) fail(`Item "${itemId}" must keep a label or an image_url.`)
  delete item.label
  delete item.imageUrl
  if (label) item.label = label
  if (imageUrl) item.imageUrl = imageUrl
}

export function removeItems(board: Board, itemIds: string[]): void {
  for (const id of itemIds) findItem(board, id)
  const gone = new Set(itemIds)
  board.items = board.items.filter((item) => !gone.has(item.id))
  for (const tierId of Object.keys(board.placements)) {
    board.placements[tierId] = board.placements[tierId]!.filter((id) => !gone.has(id))
  }
}

function findItem(board: Board, itemId: string): Item {
  const item = board.items.find((candidate) => candidate.id === itemId)
  if (!item) fail(`Unknown item "${itemId}".`)
  return item
}

function detach(board: Board, itemIds: Set<string>) {
  for (const tierId of Object.keys(board.placements)) {
    board.placements[tierId] = board.placements[tierId]!.filter((id) => !itemIds.has(id))
  }
}

/** Each listed tier gets exactly the given order; items taken from other tiers leave them. Unlisted tiers keep their items. */
export function placeItems(board: Board, placements: Record<string, string[]>): void {
  const claimed = new Set<string>()
  for (const [tierId, ids] of Object.entries(placements)) {
    findTier(board, tierId)
    for (const id of ids) {
      findItem(board, id)
      if (claimed.has(id)) fail(`Item "${id}" is listed more than once.`)
      claimed.add(id)
    }
  }
  detach(board, claimed)
  for (const [tierId, ids] of Object.entries(placements)) board.placements[tierId] = [...ids]
}

export function moveItem(board: Board, itemId: string, target: string, position?: number): void {
  const item = findItem(board, itemId)
  if (target === "pool") {
    detach(board, new Set([itemId]))
    const pool = poolItems(board).filter((candidate) => candidate.id !== itemId)
    board.items = board.items.filter((candidate) => candidate.id !== itemId)
    const before = position === undefined ? undefined : pool[Math.max(0, position)]
    const at = before ? board.items.findIndex((candidate) => candidate.id === before.id) : board.items.length
    board.items.splice(at, 0, item)
    return
  }
  findTier(board, target)
  detach(board, new Set([itemId]))
  const list = board.placements[target] ?? []
  list.splice(position === undefined ? list.length : Math.max(0, Math.min(position, list.length)), 0, itemId)
  board.placements[target] = list
}

export function poolItems(board: Board): Item[] {
  const placed = new Set(Object.values(board.placements).flat())
  return board.items.filter((item) => !placed.has(item.id))
}

export function toImport(board: Board): TierListImport {
  return validateTierListImport({
    version: 1,
    title: board.title,
    ...(board.templateSlug ? { templateSlug: board.templateSlug } : {}),
    tiers: board.tiers,
    items: board.items,
    placements: Object.fromEntries(board.tiers.map((tier) => [tier.id, board.placements[tier.id] ?? []])),
  })
}

export function summary(board: Board) {
  return {
    board_id: board.id,
    title: board.title,
    ...(board.templateSlug ? { template_slug: board.templateSlug } : {}),
    tiers: board.tiers.map((tier) => ({
      id: tier.id,
      label: tier.label,
      color: tier.color,
      item_ids: board.placements[tier.id] ?? [],
    })),
    pool_item_ids: poolItems(board).map((item) => item.id),
    item_count: board.items.length,
  }
}

export function details(board: Board) {
  return {
    ...summary(board),
    items: board.items.map((item) => ({
      id: item.id,
      ...(item.label ? { label: item.label } : {}),
      ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
    })),
  }
}
