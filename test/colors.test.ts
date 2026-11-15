import { describe, expect, it } from "vitest"
import { assertColor } from "../src/schema.js"
import { connect } from "./helpers.js"
import { decodePayload } from "../src/codec.js"

describe("tier colors", () => {
  it("keeps colors the editor understands", () => {
    for (const color of ["#f00", "#ff000080", "#EF4444", "rgb(239, 68, 68)", "rgba(0,0,0,.5)", "rgb(10 20 30 / 50%)", "hsl(120, 50%, 40%)", "hsl(0.5turn 50% 50%)"]) {
      expect(assertColor(color)).toBe(color)
    }
  })

  it("converts names and site color classes to hex", () => {
    expect(assertColor("red")).toBe("#ef4444")
    expect(assertColor(" Gold ")).toBe("#fbbf24")
    expect(assertColor("bg-red-600")).toBe("#dc2626")
  })

  it("rejects what the editor would turn gray", () => {
    for (const color of ["", "hotpink", "#ggg", "#12345", "rgb(1,2)", "rgb(1, 2 3)", "hsl(1, 2, 3)", "var(--x)", "url(x)", "rgb(1%,2,3)"]) {
      expect(() => assertColor(color), color).toThrow(/Unsupported color/)
    }
  })

  it("goes through the tools and into the link payload as hex", async () => {
    const { call } = await connect()
    const id = (await call("create_tierlist", { title: "c", tiers: [{ label: "a", color: "red" }, { label: "b", color: "hsl(10, 50%, 50%)" }] })).data.board_id
    await call("update_tier", { board_id: id, tier_id: "t2", color: "gold" })
    expect((await call("update_tier", { board_id: id, tier_id: "t2", color: "hotpink" })).isError).toBe(true)
    const { data } = await call("get_editor_link", { board_id: id })
    expect(decodePayload(data.url.split("#tm=")[1]).tiers.map((t) => t.color)).toEqual(["#ef4444", "#fbbf24"])
  })
})
