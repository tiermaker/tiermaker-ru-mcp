import { describe, expect, it } from "vitest"
import { encodePayload } from "../src/codec.js"
import type { TierListImport } from "../src/schema.js"
import { casePassed, cyrillicRatio, finalBoard, isValidPng, runChecks, unresolvedErrors, type CheckContext } from "../evals/checks.js"
import { boardForJudge, buildJudgePrompt, parseJudge } from "../evals/judge.js"
import { median, renderSummary } from "../evals/report.js"
import type { EvalCase, RunRecord, ToolCall } from "../evals/types.js"
import { pngBytes } from "./helpers.js"

const BASE = "http://localhost:3000"

const board: TierListImport = {
  version: 1,
  title: "Языки",
  tiers: [
    { id: "t1", label: "учить", color: "#22c55e" },
    { id: "t2", label: "можно", color: "yellow" },
    { id: "t3", label: "не надо", color: "#ef4444" },
  ],
  items: [
    { id: "a", label: "Python" },
    { id: "b", label: "Go" },
    { id: "c", label: "Perl", imageUrl: "https://img.example/perl.png" },
  ],
  placements: { t1: ["a"], t2: ["b"], t3: ["c"] },
}

const call = (name: string, input: Record<string, unknown> = {}, result: unknown = {}, isError = false): ToolCall => ({
  turn: 0, name, input, isError, result: typeof result === "string" ? result : JSON.stringify(result),
})

function goodCalls(b: TierListImport = board): ToolCall[] {
  return [
    call("search_templates", { query: "x" }, { templates: [{ slug: "pizza-styles" }] }),
    call("create_tierlist", { title: b.title }),
    call("place_items", {}),
    call("render_image", {}, { path: "/work/a.png" }),
    call("get_editor_link", {}, { url: `${BASE}/create#tm=${encodePayload(b)}` }),
  ]
}

const realPng = (() => {
  const bytes = pngBytes()
  return bytes.length >= 2000 ? bytes : Buffer.concat([bytes.subarray(0, bytes.length - 12), Buffer.alloc(3000), bytes.subarray(bytes.length - 12)])
})()

const ctx: CheckContext = {
  baseUrl: BASE,
  readFile: () => realPng,
  checkImage: async (url) => (url.includes("perl") ? { ok: true } : { ok: false, reason: "HTTP 404" }),
}

const baseCase: EvalCase = { id: "x", category: "c", lang: "ru", prompt: "тир-лист языков", expect: {} }
const record = (calls: ToolCall[], answer = "Готово, вот ваш тир-лист языков программирования."): RunRecord => ({
  turns: [{ prompt: baseCase.prompt, answer }], toolCalls: calls, durationMs: 1000, costUsd: 0.1,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
})
const status = (checks: Awaited<ReturnType<typeof runChecks>>["checks"], name: string) => checks.find((c) => c.name === name)

describe("eval checks", () => {
  it("passes a good run", async () => {
    const { checks, board: found } = await runChecks(
      { ...baseCase, expect: { tiers: { labels: ["учить", "можно", "не надо"], colors: ["green", "yellow", "red"] }, items: { exact: 3 }, template: "none" } },
      record(goodCalls()),
      ctx,
    )
    expect(found?.items).toHaveLength(3)
    expect(checks.filter((c) => c.status === "fail")).toEqual([])
    expect(casePassed(checks)).toBe(true)
  })

  it("fails without a link or with a link to another site", async () => {
    expect(finalBoard([], BASE).reason).toMatch(/never called/)
    const calls = goodCalls()
    calls[4]!.result = JSON.stringify({ url: "https://tiermaker.ru/create#tm=abc" })
    expect(finalBoard(calls, BASE).reason).toMatch(/does not start/)
    calls[4]!.result = JSON.stringify({ url: `${BASE}/create#tm=AAAA` })
    expect(finalBoard(calls, BASE).reason).toMatch(/does not decode/)
  })

  it("opens a short link through the site and judges the stored board", async () => {
    const calls = goodCalls()
    calls[4]!.result = JSON.stringify({ url: `${BASE}/s/Ab3dEf9hJk` })
    const stored = new Map([["Ab3dEf9hJk", encodePayload(board)]])
    const withDraft: CheckContext = { ...ctx, fetchDraft: async (id) => stored.get(id) }

    const { board: found, checks } = await runChecks({ ...baseCase, expect: { items: { exact: 3 } } }, record(calls), withDraft)

    expect(found?.items).toHaveLength(3)
    expect(status(checks, "link")?.status).toBe("pass")
    calls[4]!.result = JSON.stringify({ url: `${BASE}/s/Missing123` })
    expect((await runChecks(baseCase, record(calls), withDraft)).checks.find((c) => c.name === "link")?.reason).toMatch(/does not open/)
    calls[4]!.result = JSON.stringify({ url: `${BASE}/s/../x` })
    expect(finalBoard(calls, BASE).reason).toMatch(/malformed/)
  })

  it("flags wrong tiers, colors, counts, duplicates, pool", async () => {
    const bad: TierListImport = {
      ...board,
      tiers: [{ id: "t1", label: "S", color: "#22c55e" }, { id: "t2", label: "S", color: "#abc" }],
      items: [{ id: "a", label: "Go" }, { id: "b", label: "go" }],
      placements: { t1: ["a"] },
    }
    const { checks } = await runChecks(
      { ...baseCase, expect: { tiers: { labels: ["учить", "можно"], colors: ["red", "red"] }, items: { exact: 3 } } },
      record(goodCalls(bad)),
      ctx,
    )
    for (const name of ["tiers", "colors", "items", "unique", "placed"]) expect(status(checks, name)?.status, name).toBe("fail")
  })

  it("checks the template: expected, none, invented", async () => {
    const withTemplate = { ...board, templateSlug: "pizza-styles" }
    const run = record(goodCalls(withTemplate))
    expect(status((await runChecks({ ...baseCase, expect: { template: "pizza-styles" } }, run, ctx)).checks, "template")?.status).toBe("pass")
    expect(status((await runChecks({ ...baseCase, expect: { template: "none" } }, run, ctx)).checks, "template")?.status).toBe("fail")
    expect(status((await runChecks({ ...baseCase, expect: { template: "dota" } }, run, ctx)).checks, "template")?.status).toBe("fail")
    const invented = goodCalls({ ...board, templateSlug: "made-up" })
    invented.splice(1, 0, call("create_tierlist", { template_slug: "made-up" }, "Not found in the TierMaker catalog.", true))
    expect(status((await runChecks(baseCase, record(invented), ctx)).checks, "template")?.status).toBe("fail")
  })

  it("verifies image urls", async () => {
    const withBadImage: TierListImport = { ...board, items: [{ id: "a", label: "A", imageUrl: "https://img.example/invented.png" }, ...board.items.slice(1)] }
    const { checks } = await runChecks(baseCase, record(goodCalls(withBadImage)), ctx)
    expect(status(checks, "images")?.status).toBe("fail")
    expect(status((await runChecks(baseCase, record(goodCalls()), ctx)).checks, "images")?.status).toBe("pass")
  })

  it("checks edits on the final board", async () => {
    const expectation = { final: { placed: [{ item: "go", tier: "учить" }], present: ["Python"], absent: ["Perl", "Rust"] } }
    const { checks } = await runChecks({ ...baseCase, expect: expectation }, record(goodCalls()), ctx)
    expect(status(checks, "final")?.reason).toMatch(/"go" is in можно.*"Perl" is still there/)
  })

  it("detects a stale link or PNG and bad PNGs", async () => {
    const stale = goodCalls()
    stale.push(call("move_item", {}, {}))
    expect(status((await runChecks(baseCase, record(stale), ctx)).checks, "fresh")?.status).toBe("fail")
    expect(isValidPng(Buffer.alloc(10))).toMatch(/only/)
    expect(isValidPng(Buffer.alloc(3000))).toMatch(/signature/)
    expect(isValidPng(realPng)).toBeUndefined()
    const missing = await runChecks(baseCase, record(goodCalls()), { ...ctx, readFile: () => undefined })
    expect(status(missing.checks, "png")?.status).toBe("fail")
  })

  it("checks answer language and tool errors", async () => {
    expect(cyrillicRatio("Привет hello")).toBeCloseTo(6 / 11)
    const en = await runChecks({ ...baseCase, lang: "en" }, record(goodCalls()), ctx)
    expect(status(en.checks, "language")?.status).toBe("fail")
    const ruWithLinks = record(goodCalls(), "Готово: `/tmp/Very-Long-English-Path/file.png` http://localhost:3000/create#tm=abcdefghijklmnop Python, Go")
    expect(status((await runChecks(baseCase, ruWithLinks, ctx)).checks, "language")?.status).toBe("pass")
    const calls = goodCalls()
    calls.push(call("move_item", {}, "Unknown item", true))
    expect(unresolvedErrors(calls)).toHaveLength(1)
    expect(status((await runChecks(baseCase, record(calls), ctx)).checks, "tools_clean")?.status).toBe("fail")
    const recovered = [call("add_items", {}, "bad", true), ...goodCalls(), call("add_items", {})]
    expect(unresolvedErrors(recovered)).toHaveLength(0)
  })

  it("handles clarify cases and answer patterns", async () => {
    const clarify: EvalCase = { ...baseCase, expect: { clarify: true } }
    expect(status((await runChecks(clarify, record([], "Какая тема тир-листа?"), ctx)).checks, "clarify")?.status).toBe("pass")
    expect(status((await runChecks(clarify, record([], "Хорошо."), ctx)).checks, "clarify")?.status).toBe("fail")
    expect(status((await runChecks(clarify, record(goodCalls(), "Что дальше?"), ctx)).checks, "clarify")?.status).toBe("fail")
    const limit: EvalCase = { ...baseCase, expect: { answer_matches: ["200"] } }
    expect(status((await runChecks(limit, record(goodCalls(), "Максимум 200 карточек"), ctx)).checks, "answer")?.status).toBe("pass")
    expect(status((await runChecks(limit, record(goodCalls(), "Готово"), ctx)).checks, "answer")?.status).toBe("fail")
  })

  it("reports agent errors", async () => {
    const run = { ...record([]), error: "no result after 600 s", timedOut: true }
    const { checks } = await runChecks(baseCase, run, ctx)
    expect(status(checks, "agent")?.reason).toMatch(/timed out/)
    expect(casePassed(checks)).toBe(false)
  })
})

describe("judge and report", () => {
  it("builds the judge prompt and parses scores", () => {
    expect(boardForJudge(board)).toContain("учить: Python")
    expect(buildJudgePrompt(baseCase, board, "ответ")).toContain("Request 1: тир-лист языков")
    const scores = parseJudge('text {"relevance":5,"arrangement":4,"completeness":null,"answer":3,"notes":{"relevance":"ok"}} end')
    expect(scores).toMatchObject({ relevance: 5, completeness: null, notes: { relevance: "ok", answer: "" } })
    expect(() => parseJudge('{"relevance":9,"arrangement":1,"completeness":1,"answer":1}')).toThrow(/invalid/)
    expect(() => parseJudge("nothing")).toThrow(/no JSON/)
  })

  it("renders a summary with a comparison", async () => {
    const meta = { runId: "r2", startedAt: "now", agentModel: "sonnet", judgeModel: "opus", skill: "tiermaker", baseUrl: BASE, mcpVersion: "0.1.0" }
    const { checks } = await runChecks(baseCase, record(goodCalls()), ctx)
    const result = { case: baseCase, run: record(goodCalls()), checks, pass: casePassed(checks) }
    const failed = { ...result, pass: false }
    const text = renderSummary({ meta, results: [result] }, { meta: { ...meta, runId: "r1" }, results: [failed] })
    expect(text).toContain("Pass rate: 1/1")
    expect(text).toContain("fail → pass")
    expect(median([3, 1, 2, 10])).toBe(2.5)
  })
})

describe("eval hardening", () => {
  const png = (body: Uint8Array | ReadableStream<Uint8Array>, headers: Record<string, string> = { "content-type": "image/png" }) =>
    new Response(body as BodyInit, { status: 200, headers })

  it("limits the image body by counting bytes, not by trusting headers", async () => {
    const { checkImageUrl } = await import("../evals/images.js")
    const small = new Uint8Array(100)
    expect(await checkImageUrl("https://x/ok.png", (async () => png(small)) as typeof fetch, 1000)).toEqual({ ok: true })
    // declared too large
    const declared = (async (_: unknown, init?: RequestInit) =>
      init?.method === "HEAD" ? png(new Uint8Array(0), { "content-type": "image/png", "content-length": "5000" }) : png(small)) as typeof fetch
    expect((await checkImageUrl("https://x/big.png", declared, 1000)).reason).toMatch(/limit 1000/)
    // chunked / endless body without content-length: stops after the limit
    let pulled = 0
    const endless = (async (_: unknown, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 405 })
      return png(new ReadableStream({ pull(controller) { pulled += 400; controller.enqueue(new Uint8Array(400)) } }))
    }) as typeof fetch
    const verdict = await checkImageUrl("https://x/endless.png", endless, 1000)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/larger than 1000/)
    expect(pulled).toBeLessThan(4000)
    // not an image / not 200
    expect((await checkImageUrl("https://x/p", (async () => png(small, { "content-type": "text/html" })) as typeof fetch, 1000)).reason).toMatch(/content-type/)
    expect((await checkImageUrl("https://x/m", (async () => new Response("", { status: 404 })) as typeof fetch, 1000)).reason).toMatch(/404/)
  })

  it("does not accept an answer without prose as a language match", async () => {
    const linksOnly = record(goodCalls(), "`/tmp/file.png` http://localhost:3000/create#tm=abcdef")
    for (const lang of ["en", "ru"] as const) {
      const { checks } = await runChecks({ ...baseCase, lang }, linksOnly, ctx)
      expect(status(checks, "language")?.status).toBe("fail")
      expect(status(checks, "language")?.reason).toMatch(/no prose/)
    }
    const { checks } = await runChecks({ ...baseCase, lang: "en" }, record(goodCalls(), "Done: here is your tier list."), ctx)
    expect(status(checks, "language")?.status).toBe("pass")
  })

  it("allows one link occurrence in the final answer and rejects more", async () => {
    const link = `${BASE}/create#tm=${encodePayload(board)}`
    const ok = `Готово: ${link}. Критерий — удобство.`
    expect(status((await runChecks(baseCase, record(goodCalls(), ok), ctx)).checks, "links")?.status).toBe("pass")
    // the same link repeated is still a second link
    expect(status((await runChecks(baseCase, record(goodCalls(), `${ok} (${link})`), ctx)).checks, "links")?.status).toBe("fail")
    const many = `${ok} Ещё https://tiermaker.ru/templates/pizza-styles и [сайт](https://tiermaker.ru).`
    const { checks } = await runChecks(baseCase, record(goodCalls(), many), ctx)
    expect(status(checks, "links")?.status).toBe("fail")
    expect(casePassed(checks)).toBe(false)
  })

  it("fails a single link that is not the one get_editor_link returned", async () => {
    const fake = `${BASE}/create#tm=${Buffer.from('{"t":"..."}').toString("base64url")}`
    const { checks } = await runChecks(baseCase, record(goodCalls(), `Готово: ${fake}. Критерий — удобство.`), ctx)
    expect(status(checks, "links")?.status).toBe("fail")
    expect(status(checks, "links")?.reason).toMatch(/made up or altered/)
    expect(casePassed(checks)).toBe(false)
  })

  it("compares the answer link with the last of two successful get_editor_link calls", async () => {
    const first = { ...board, title: "first" }
    const urlOf = (b: TierListImport) => `${BASE}/create#tm=${encodePayload(b)}`
    const calls = [...goodCalls(first), call("get_editor_link", {}, { url: urlOf(board) })]
    const latest = await runChecks(baseCase, record(calls, `Готово: ${urlOf(board)}. Критерий — удобство.`), ctx)
    expect(status(latest.checks, "links")?.status).toBe("pass")
    const stale = await runChecks(baseCase, record(calls, `Готово: ${urlOf(first)}. Критерий — удобство.`), ctx)
    expect(status(stale.checks, "links")?.status).toBe("fail")
    expect(status(stale.checks, "links")?.reason).toMatch(/made up or altered/)
  })

  it("requires search_images and real urls when pictures were requested", async () => {
    const pictured: TierListImport = { ...board, items: board.items.map((item) => ({ ...item, imageUrl: `https://img.example/${item.id}.png` })) }
    const wanted = { ...baseCase, expect: { images: { min_share: 0.5 } } }
    const search = call("search_images", { query: "x" }, { images: pictured.items.map((item) => ({ url: item.imageUrl })) })
    const good = await runChecks(wanted, record([search, ...goodCalls(pictured)]), { ...ctx, checkImage: async () => ({ ok: true }) })
    expect(status(good.checks, "image_source")?.status).toBe("pass")
    expect(status((await runChecks(wanted, record(goodCalls(pictured)), { ...ctx, checkImage: async () => ({ ok: true }) })).checks, "image_source")?.reason).toMatch(/never used/)
    const partial = call("search_images", { query: "x" }, { images: [{ url: "https://img.example/a.png" }] })
    expect(status((await runChecks(wanted, record([partial, ...goodCalls(pictured)]), { ...ctx, checkImage: async () => ({ ok: true }) })).checks, "image_source")?.reason).toMatch(/invented/)
    // pictures the site lists for the template need no search
    const templated = { ...pictured, templateSlug: "cars" }
    const listed = { ...ctx, checkImage: async () => ({ ok: true }), templateImages: async () => new Set(pictured.items.map((item) => item.imageUrl!)) }
    const fromTemplate = await runChecks(wanted, record(goodCalls(templated)), listed)
    expect(status(fromTemplate.checks, "image_source")?.reason).toMatch(/pictures of template cars/)
    // a template slug alone proves nothing: arbitrary urls without a search fail
    const invented = await runChecks(wanted, record(goodCalls(templated)), { ...listed, templateImages: async () => new Set(["https://img.example/other.png"]) })
    expect(status(invented.checks, "image_source")?.status).toBe("fail")
    expect(status(invented.checks, "image_source")?.reason).toMatch(/never used/)
    const unreachable = await runChecks(wanted, record(goodCalls(templated)), { ...listed, templateImages: async () => undefined })
    expect(status(unreachable.checks, "image_source")?.status).toBe("fail")
    // a picture added after the template must come from a search result
    const added = { ...templated, items: templated.items.map((item, i) => (i === 0 ? { ...item, imageUrl: "https://img.example/added.png" } : item)) }
    const addedBad = await runChecks(wanted, record([search, ...goodCalls(added)]), listed)
    expect(status(addedBad.checks, "image_source")?.reason).toMatch(/invented/)
    const searchedToo = call("search_images", { query: "x" }, { images: [{ url: "https://img.example/added.png" }] })
    expect(status((await runChecks(wanted, record([searchedToo, ...goodCalls(added)]), listed)).checks, "image_source")?.status).toBe("pass")
    const bare = await runChecks(wanted, record([search, ...goodCalls()]), ctx)
    expect(status(bare.checks, "image_source")?.reason).toMatch(/1\/3 items/)
  })

  it("does not fail a run for an external image search that stayed down", async () => {
    const down = call("search_images", { query: "x" }, "Wikimedia Commons answered with HTTP 429", true)
    expect(status((await runChecks(baseCase, record([down, ...goodCalls()]), ctx)).checks, "tools_clean")?.status).toBe("pass")
    const broken = call("place_items", {}, "unknown tier", true)
    expect(status((await runChecks(baseCase, record([...goodCalls(), broken]), ctx)).checks, "tools_clean")?.status).toBe("fail")
  })

  it("treats a dead MCP as an infrastructure error", async () => {
    const { mcpInitError } = await import("../evals/preflight.js")
    expect(mcpInitError({ type: "system", subtype: "init", mcp_servers: [{ name: "tiermaker", status: "connected" }] })).toBeUndefined()
    expect(mcpInitError({ type: "system", subtype: "init", mcp_servers: [{ name: "tiermaker", status: "failed" }] })).toMatch(/failed/)
    expect(mcpInitError({ type: "system", subtype: "init", mcp_servers: [] })).toMatch(/missing/)
    expect(mcpInitError({ type: "assistant" })).toBeUndefined()
    // a transcript that only has Skill and an answer admitting the connection failure must not pass, even for a clarify case
    const dead = record([call("Skill", {}, "Launching skill: tiermaker")], "tiermaker MCP server failed to connect (CONNECTION_CLOSED). Which topic?")
    const { checks } = await runChecks({ ...baseCase, expect: { clarify: true } }, dead, ctx)
    expect(status(checks, "mcp")?.status).toBe("fail")
    expect(casePassed(checks)).toBe(false)
  })

  it("runs agent.ts against a fake claude that reports a failed MCP", async () => {
    const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "fake-claude-"))
    const script = join(dir, "claude")
    writeFileSync(script, `#!/bin/sh\necho '{"type":"system","subtype":"init","mcp_servers":[{"name":"tiermaker","status":"failed"}]}'\ncat >/dev/null\n`)
    chmodSync(script, 0o755)
    const { runAgent } = await import("../evals/agent.js")
    const run = await runAgent({ prompts: ["hi"], cwd: dir, mcpConfig: "x", model: "m", timeoutMs: 5000, env: { PATH: `${dir}:${process.env.PATH}` } })
    expect(run.error).toMatch(/tiermaker is failed/)
    expect(run.timedOut).toBeUndefined()
  })
})
