import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as schema from "../src/schema.js"

// Numbers from frontend/lib/tierlist-import.ts and lib/content-rules.ts of the TierMaker site.
describe("schema limits match the site", () => {
  it("has the same constants", () => {
    expect(schema.MAX_TIERS).toBe(20)
    expect(schema.MAX_ITEMS).toBe(200)
    expect(schema.MAX_COMPRESSED_BYTES).toBe(32 * 1024)
    expect(schema.MAX_UNCOMPRESSED_BYTES).toBe(512 * 1024)
    expect(schema.MAX_TEXT_LENGTH).toBe(128)
    expect(schema.MAX_ID_LENGTH).toBe(128)
    expect(schema.MAX_COLOR_LENGTH).toBe(64)
    expect(schema.MAX_TEMPLATE_SLUG_LENGTH).toBe(160)
  })

  it("documents the same text limit", () => {
    const docs = readFileSync(new URL("../docs/tierlist-import-v1.md", import.meta.url), "utf8")
    expect(docs).toMatch(/limited to 128 characters/)
    expect(docs).toMatch(/IDs are at most 128 characters; `templateSlug` is at most 160/)
  })
})
