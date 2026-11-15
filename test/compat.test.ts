import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { decodePayload, encodePayload } from "../src/codec.js"

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"))
const names = ["basic", "default-tiers", "images-pool"]

/**
 * `site-payloads.json` holds payloads produced by the TierMaker site's own encoder
 * (CompressionStream "deflate" + base64url); `mcp-payloads.json` holds payloads produced by this
 * package and verified to decode with the site's decoder.
 */
describe("compatibility with the TierMaker site", () => {
  const sitePayloads = read("site-payloads.json")
  const mcpPayloads = read("mcp-payloads.json")

  for (const name of names) {
    it(`decodes a site payload: ${name}`, () => {
      expect(decodePayload(sitePayloads[name])).toEqual(read(`${name}.json`))
    })

    it(`decodes its own payload: ${name}`, () => {
      expect(decodePayload(mcpPayloads[name])).toEqual(read(`${name}.json`))
    })

    it(`re-encodes to something that decodes the same: ${name}`, () => {
      expect(decodePayload(encodePayload(read(`${name}.json`)))).toEqual(read(`${name}.json`))
    })
  }
})

describe("tier colors on the site", () => {
  // colors.payload.txt was decoded by the site's decodeTierListImport and every color passed its
  // isCssTierColor() unchanged (no fallback to gray).
  it("decodes the colors fixture and every color is re-accepted", async () => {
    const { assertColor } = await import("../src/schema.js")
    const payload = readFileSync(new URL("./fixtures/colors.payload.txt", import.meta.url), "utf8").trim()
    const board = read("colors.json")
    const decoded = decodePayload(payload)
    expect(decoded).toEqual(board)
    for (const tier of decoded.tiers) expect(assertColor(tier.color)).toBe(tier.color)
  })
})
