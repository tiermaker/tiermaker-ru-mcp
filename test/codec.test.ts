import { describe, expect, it } from "vitest"
import { buildEditorLink, decodePayload, encodePayload } from "../src/codec.js"
import { MAX_ITEMS, MAX_TIERS, validateTierListImport, type TierListImport } from "../src/schema.js"

const board: TierListImport = {
  version: 1,
  title: "Любимые фрукты",
  templateSlug: "fruit-template",
  tiers: [
    { id: "top", label: "Лучшее", color: "#ef4444" },
    { id: "rest", label: "Остальное", color: "#3b82f6" },
  ],
  items: [
    { id: "apple", label: "Яблоко", imageUrl: "https://images.example/apple.png" },
    { id: "pear", label: "Груша" },
    { id: "plum", label: "Слива", imageUrl: "http://images.example/plum.jpg" },
  ],
  placements: { top: ["apple"], rest: ["plum"] },
}

describe("payload codec", () => {
  it("round-trips a board", () => {
    const payload = encodePayload(board)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodePayload(payload)).toEqual(board)
  })

  it("builds a fragment link", () => {
    expect(buildEditorLink("https://tiermaker.ru/", "abc")).toBe("https://tiermaker.ru/create#tm=abc")
  })

  it("rejects garbage", () => {
    expect(() => decodePayload("not base64!")).toThrow(/base64url/)
    expect(() => decodePayload("AAAA")).toThrow(/decoded/)
  })

  it("rejects payloads over 32 KB compressed", () => {
    const items = Array.from({ length: MAX_ITEMS }, (_, i) => ({
      id: `item-${i}`,
      imageUrl: `https://images.example/${i}-${Array.from({ length: 16 }, () => crypto.randomUUID()).join("-")}.png`,
    }))
    expect(() => encodePayload({ ...board, items, placements: {} })).toThrow(/too large/)
  })
})

describe("validateTierListImport", () => {
  it("enforces limits", () => {
    const tiers = Array.from({ length: MAX_TIERS + 1 }, (_, i) => ({ id: `t${i}`, label: "x", color: "#fff" }))
    expect(() => validateTierListImport({ ...board, tiers, placements: {} })).toThrow(/20 tiers/)
    const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ id: `i${i}`, label: "x" }))
    expect(() => validateTierListImport({ ...board, items, placements: {} })).toThrow(/200 items/)
  })

  it("rejects non-http image urls and bad references", () => {
    const bad = (imageUrl: string) => ({ ...board, items: [{ id: "a", imageUrl }], placements: {} })
    expect(() => validateTierListImport(bad("javascript:alert(1)"))).toThrow(/http/)
    expect(() => validateTierListImport(bad("data:image/png;base64,AAAA"))).toThrow(/http/)
    expect(() => validateTierListImport({ ...board, placements: { top: ["ghost"] } })).toThrow(/unknown item/)
    expect(() => validateTierListImport({ ...board, placements: { top: ["apple"], rest: ["apple"] } })).toThrow(/more than once/)
    expect(() => validateTierListImport({ ...board, extra: 1 })).toThrow(/unsupported/)
  })
})
