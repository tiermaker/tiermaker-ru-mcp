import { decodePayload } from "../src/codec.js"
import { MAX_ITEMS, assertColor, type TierListImport } from "../src/schema.js"
import type { CheckResult, EvalCase, RunRecord, ToolCall } from "./types.js"

export type CheckContext = {
  baseUrl: string
  /** Bytes of a file written by the agent's render_image call, if it exists. */
  readFile: (path: string) => Buffer | undefined
  /** Whether the URL answers 200 with an image/* content type. */
  checkImage: (url: string) => Promise<{ ok: boolean; reason?: string }>
  /** Image urls the site itself lists for a template (not what the agent claims); undefined when it cannot be fetched. */
  templateImages?: (slug: string) => Promise<Set<string> | undefined>
  /** Stored payload of a short link (`/s/<id>`) as the site returns it; undefined when it is missing or unreachable. */
  fetchDraft?: (id: string) => Promise<string | undefined>
}

const MUTATING = new Set([
  "create_tierlist", "set_tiers", "update_tier", "remove_tier", "add_items",
  "update_item", "remove_items", "place_items", "move_item",
])

const pass = (name: string, reason = "ok"): CheckResult => ({ name, status: "pass", reason })
const fail = (name: string, reason: string): CheckResult => ({ name, status: "fail", reason })
const skip = (name: string, reason: string): CheckResult => ({ name, status: "skip", reason })

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ")
const sameColor = (a: string, b: string) => {
  try {
    return norm(assertColor(a)) === norm(assertColor(b))
  } catch {
    return false
  }
}

function ok(call: ToolCall): boolean {
  return !call.isError
}

function lastIndex(calls: ToolCall[], predicate: (call: ToolCall) => boolean): number {
  for (let i = calls.length - 1; i >= 0; i--) if (predicate(calls[i]!)) return i
  return -1
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** The editor link the agent handed over last, decoded; or the reason it is unusable. */
export function finalBoard(
  calls: ToolCall[],
  baseUrl: string,
): { board?: TierListImport; url?: string; reason?: string; draftId?: string } {
  const index = lastIndex(calls, (call) => call.name === "get_editor_link" && ok(call))
  if (index < 0) return { reason: "get_editor_link was never called successfully" }
  const url = parseJson(calls[index]!.result)?.url
  if (typeof url !== "string") return { reason: "get_editor_link returned no url (file fallback?)" }
  const root = baseUrl.replace(/\/+$/, "")
  const shortId = url.startsWith(`${root}/s/`) ? url.slice(root.length + 3) : undefined
  if (shortId !== undefined) return /^[0-9A-Za-z]{10}$/.test(shortId) ? { url, draftId: shortId } : { url, reason: "short link has a malformed id" }
  const prefix = `${root}/create#tm=`
  if (!url.startsWith(prefix)) return { url, reason: `link does not start with ${prefix}` }
  try {
    return { url, board: decodePayload(url.slice(prefix.length)) }
  } catch (error) {
    return { url, reason: `link does not decode: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Like finalBoard, but also opens short links through the site (the agent's board lives there, not in the url). */
export async function resolveFinalBoard(calls: ToolCall[], ctx: CheckContext) {
  const found = finalBoard(calls, ctx.baseUrl)
  if (!found.draftId) return found
  if (!ctx.fetchDraft) return { ...found, reason: "short link cannot be opened (no fetchDraft)" }
  const payload = await ctx.fetchDraft(found.draftId)
  if (!payload) return { url: found.url, reason: "short link does not open on the site" }
  try {
    return { url: found.url, board: decodePayload(payload) }
  } catch (error) {
    return { url: found.url, reason: `short link payload does not decode: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function isValidPng(bytes: Buffer): string | undefined {
  if (bytes.length < 2000) return `PNG is only ${bytes.length} bytes`
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "not a PNG (bad signature)"
  if (bytes.subarray(12, 16).toString("latin1") !== "IHDR") return "PNG has no IHDR"
  if (bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0) return "PNG has zero size"
  if (bytes.subarray(bytes.length - 8, bytes.length - 4).toString("latin1") !== "IEND") return "PNG is truncated (no IEND)"
  return undefined
}

export function cyrillicRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? []
  if (!letters.length) return 0
  return letters.filter((char) => /\p{Script=Cyrillic}/u.test(char)).length / letters.length
}

function checkLink(board: TierListImport | undefined, reason?: string): CheckResult {
  return board ? pass("link", `${board.tiers.length} tiers, ${board.items.length} items`) : fail("link", reason ?? "no link")
}

async function checkPng(calls: ToolCall[], ctx: CheckContext): Promise<CheckResult> {
  const index = lastIndex(calls, (call) => call.name === "render_image" && ok(call))
  if (index < 0) return fail("png", "render_image was never called successfully")
  const path = parseJson(calls[index]!.result)?.path
  if (typeof path !== "string") return fail("png", "render_image returned no path")
  const bytes = ctx.readFile(path)
  if (!bytes) return fail("png", `PNG file not found: ${path}`)
  const problem = isValidPng(bytes)
  return problem ? fail("png", problem) : pass("png", `${bytes.length} bytes`)
}

function checkFresh(calls: ToolCall[]): CheckResult {
  const mutated = lastIndex(calls, (call) => MUTATING.has(call.name) && ok(call))
  const rendered = lastIndex(calls, (call) => call.name === "render_image" && ok(call))
  const linked = lastIndex(calls, (call) => call.name === "get_editor_link" && ok(call))
  if (rendered < mutated) return fail("fresh", "PNG was rendered before the last change to the board")
  if (linked < mutated) return fail("fresh", "editor link was made before the last change to the board")
  return pass("fresh")
}

function checkTiers(board: TierListImport, expected: EvalCase["expect"]["tiers"]): CheckResult {
  const labels = board.tiers.map((tier) => tier.label)
  const e = expected ?? {}
  if (e.labels) {
    const want = e.labels.map(norm)
    const got = labels.map(norm)
    if (want.length !== got.length || want.some((label, i) => label !== got[i])) {
      return fail("tiers", `expected [${e.labels.join(", ")}], got [${labels.join(", ")}]`)
    }
  }
  const missing = (e.include ?? []).filter((label) => !labels.some((got) => norm(got) === norm(label)))
  if (missing.length) return fail("tiers", `missing tiers: ${missing.join(", ")}; got [${labels.join(", ")}]`)
  const min = e.min ?? (e.labels ? 0 : 2)
  const max = e.max ?? (e.labels ? 99 : 10)
  if (labels.length < min || labels.length > max) return fail("tiers", `${labels.length} tiers, expected ${min}..${max}`)
  if (new Set(labels.map(norm)).size !== labels.length) return fail("tiers", "duplicate tier labels")
  return pass("tiers", labels.join(" / "))
}

function checkColors(board: TierListImport, expected?: string[]): CheckResult {
  const bad = board.tiers.filter((tier) => {
    try {
      assertColor(tier.color)
      return false
    } catch {
      return true
    }
  })
  if (bad.length) return fail("colors", `invalid colors: ${bad.map((tier) => `${tier.label}=${tier.color}`).join(", ")}`)
  if (expected) {
    const mismatch = expected.map((color, i) => ({ color, tier: board.tiers[i] })).filter(({ color, tier }) => !tier || !sameColor(tier.color, color))
    if (mismatch.length) {
      return fail("colors", `expected ${expected.join(", ")}, got ${board.tiers.map((tier) => tier.color).join(", ")}`)
    }
  }
  return pass("colors")
}

function checkItems(board: TierListImport, expected: EvalCase["expect"]["items"]): CheckResult {
  const count = board.items.length
  const e = expected ?? {}
  if (e.exact !== undefined) {
    return count === e.exact ? pass("items", `${count}`) : fail("items", `expected exactly ${e.exact}, got ${count}`)
  }
  const min = e.min ?? 3
  const max = Math.min(e.max ?? MAX_ITEMS, MAX_ITEMS)
  return count >= min && count <= max ? pass("items", `${count}`) : fail("items", `${count} items, expected ${min}..${max}`)
}

function checkUnique(board: TierListImport): CheckResult {
  const seen = new Map<string, string>()
  const dupes: string[] = []
  for (const item of board.items) {
    const key = norm(item.label ?? item.imageUrl ?? item.id)
    if (seen.has(key)) dupes.push(item.label ?? item.id)
    seen.set(key, item.id)
  }
  return dupes.length ? fail("unique", `duplicates: ${dupes.slice(0, 5).join(", ")}`) : pass("unique")
}

function checkPlaced(board: TierListImport): CheckResult {
  const placed = new Set(Object.values(board.placements).flat())
  const pool = board.items.filter((item) => !placed.has(item.id))
  return pool.length
    ? fail("placed", `${pool.length} of ${board.items.length} items left in the pool: ${pool.slice(0, 4).map((item) => item.label ?? item.id).join(", ")}`)
    : pass("placed")
}

function checkTemplate(board: TierListImport, calls: ToolCall[], expected: string | undefined, prompt: string): CheckResult {
  const slugs = calls
    .filter((call) => (call.name === "create_tierlist" && call.input.template_slug) || call.name === "get_template")
    .map((call) => ({ call, slug: String(call.name === "get_template" ? call.input.slug : call.input.template_slug) }))
  const bad = slugs.find(({ call }) => call.isError)
  if (bad) return fail("template", `unknown template slug "${bad.slug}" (${bad.call.result.slice(0, 80)})`)
  const found = calls.filter((call) => call.name === "search_templates" && ok(call)).map((call) => call.result).join("\n")
  if (board.templateSlug && !found.includes(`"${board.templateSlug}"`) && !prompt.includes(board.templateSlug)) {
    return fail("template", `slug "${board.templateSlug}" never appeared in search results`)
  }
  const used = board.templateSlug
  if (expected === "none") return used ? fail("template", `expected no template, used "${used}"`) : pass("template", "none used")
  if (expected === "any") return used ? pass("template", used) : fail("template", "expected some template, none used")
  if (expected) return used === expected ? pass("template", used) : fail("template", `expected "${expected}", got ${used ? `"${used}"` : "none"}`)
  return pass("template", used ?? "none used")
}

async function checkImages(board: TierListImport, ctx: CheckContext): Promise<CheckResult> {
  const urls = [...new Set(board.items.map((item) => item.imageUrl).filter((url): url is string => Boolean(url)))]
  if (!urls.length) return skip("images", "no image urls on the board")
  const results = await Promise.all(urls.map(async (url) => ({ url, ...(await ctx.checkImage(url)) })))
  const bad = results.filter((result) => !result.ok)
  return bad.length
    ? fail("images", `${bad.length}/${urls.length} image urls do not answer with an image (${bad[0]!.url}: ${bad[0]!.reason ?? "?"})`)
    : pass("images", `${urls.length} urls ok`)
}

/**
 * The user asked for pictures. Every picture is either one the site lists for the template used (checked against the
 * site, not against the agent) or a url that `search_images` returned; nothing else, and no invented urls.
 */
async function checkImageSource(
  board: TierListImport,
  calls: ToolCall[],
  expected: NonNullable<EvalCase["expect"]["images"]>,
  ctx: CheckContext,
): Promise<CheckResult> {
  const withImage = board.items.filter((item) => item.imageUrl)
  const share = board.items.length ? withImage.length / board.items.length : 0
  const min = expected.min_share ?? 0.5
  if (share < min) return fail("image_source", `${withImage.length}/${board.items.length} items have an image, expected at least ${Math.round(min * 100)}%`)
  const template = board.templateSlug ? await ctx.templateImages?.(board.templateSlug) : undefined
  const other = withImage.filter((item) => !template?.has(item.imageUrl!))
  if (!other.length) return pass("image_source", `${withImage.length}/${board.items.length} images are the pictures of template ${board.templateSlug}`)
  const found = calls.filter((call) => call.name === "search_images" && ok(call)).map((call) => call.result).join("\n")
  if (!found) return fail("image_source", `${other.length} pictures are not from the template and search_images was never used`)
  const invented = other.filter((item) => !found.includes(item.imageUrl!) && !found.includes(JSON.stringify(item.imageUrl).slice(1, -1)))
  return invented.length
    ? fail("image_source", `${invented.length} image urls come neither from the template nor from search_images (invented?): ${invented[0]!.imageUrl}`)
    : pass("image_source", `${withImage.length}/${board.items.length} items with images from the template or search_images`)
}

function tierOf(board: TierListImport, itemId: string): string | undefined {
  const tierId = Object.entries(board.placements).find(([, ids]) => ids.includes(itemId))?.[0]
  return board.tiers.find((tier) => tier.id === tierId)?.label
}

function checkFinal(board: TierListImport, expected: NonNullable<EvalCase["expect"]["final"]>): CheckResult {
  const problems: string[] = []
  const find = (needle: string) => board.items.filter((item) => norm(item.label ?? "").includes(norm(needle)))
  for (const { item, tier } of expected.placed ?? []) {
    const matches = find(item)
    if (!matches.length) problems.push(`"${item}" is not on the board`)
    else if (!matches.some((match) => norm(tierOf(board, match.id) ?? "") === norm(tier))) {
      problems.push(`"${item}" is in ${tierOf(board, matches[0]!.id) ?? "the pool"}, expected ${tier}`)
    }
  }
  for (const item of expected.present ?? []) if (!find(item).length) problems.push(`"${item}" is missing`)
  for (const item of expected.absent ?? []) if (find(item).length) problems.push(`"${item}" is still there`)
  for (const label of expected.tier_labels ?? []) {
    if (!board.tiers.some((tier) => norm(tier.label) === norm(label))) problems.push(`no tier "${label}"`)
  }
  return problems.length ? fail("final", problems.join("; ")) : pass("final")
}

/** Links, file paths and code spans say nothing about the language of the prose. */
const prose = (text: string) => text.replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ")

const MIN_PROSE_LETTERS = 5

/** The final answer hands over one link (the editor link), not several. */
export const MAX_LINKS = 1

export function checkLinks(answer: string, calls: ToolCall[]): CheckResult {
  // every occurrence counts: the same link repeated is still more than one link
  const links = (answer.match(/https?:\/\/[^\s)>\]"'`]+/g) ?? []).map((link) => link.replace(/[.,;:!?]+$/, ""))
  if (links.length > MAX_LINKS) return fail("links", `${links.length} links in the answer, expected at most ${MAX_LINKS}`)
  // the one link must be the editor link the tool returned, not one the agent made up
  const index = lastIndex(calls, (call) => call.name === "get_editor_link" && ok(call))
  const editorUrl = index < 0 ? undefined : parseJson(calls[index]!.result)?.url
  if (links[0] && typeof editorUrl === "string" && links[0] !== editorUrl) {
    return fail("links", "the link in the answer is not the one get_editor_link returned (made up or altered)")
  }
  return pass("links", `${links.length}`)
}

function checkLanguage(lang: EvalCase["lang"], answer: string): CheckResult {
  const ratio = cyrillicRatio(prose(answer))
  if ((prose(answer).match(/\p{L}/gu) ?? []).length < MIN_PROSE_LETTERS) {
    return fail("language", "the final answer has no prose (only links, paths or code), so its language is not established")
  }
  if (lang === "ru") return ratio >= 0.4 ? pass("language") : fail("language", `expected Russian, ${Math.round(ratio * 100)}% Cyrillic`)
  return ratio <= 0.2 ? pass("language") : fail("language", `expected English, ${Math.round(ratio * 100)}% Cyrillic`)
}

/** Errors that were never followed by a successful call of the same tool. */
export function unresolvedErrors(calls: ToolCall[]): ToolCall[] {
  return calls.filter((call, i) => call.isError && !calls.slice(i + 1).some((later) => later.name === call.name && ok(later)))
}

/** Wikimedia may throttle or be unreachable: the agent is expected to carry on without images, so this is not a tool misuse. */
const EXTERNAL = new Set(["search_images"])

function checkToolsClean(calls: ToolCall[]): CheckResult {
  const left = unresolvedErrors(calls).filter((call) => !EXTERNAL.has(call.name))
  const errors = calls.filter((call) => call.isError).length
  return left.length
    ? fail("tools_clean", `unresolved ${left[0]!.name} error: ${left[0]!.result.slice(0, 100)}`)
    : pass("tools_clean", errors ? `${errors} recovered error(s)` : "no errors")
}

function checkAnswer(answer: string, patterns: string[]): CheckResult {
  const missing = patterns.filter((pattern) => !new RegExp(pattern, "iu").test(answer))
  return missing.length ? fail("answer", `answer does not match: ${missing.join(", ")}`) : pass("answer")
}

function checkClarify(calls: ToolCall[], answer: string): CheckResult {
  const created = calls.some((call) => call.name === "create_tierlist")
  if (created) return fail("clarify", "built a board without knowing the topic")
  return /[?？]/.test(answer) ? pass("clarify", "asked a question") : fail("clarify", "no board, but the answer asks nothing")
}

const MCP_DOWN = /CONNECTION_CLOSED|failed to connect|MCP server .* (?:is )?(?:not connected|failed)/i

/** The agent's session never had a working MCP: an infrastructure error, whatever the agent then said. */
function checkMcpUp(calls: ToolCall[], answer: string): CheckResult | undefined {
  const hit = calls.find((call) => MCP_DOWN.test(call.result)) ?? (MCP_DOWN.test(answer) ? { name: "answer" } : undefined)
  return hit ? fail("mcp", `the tiermaker MCP server was not usable (${hit.name} mentions a connection failure)`) : undefined
}

/** All deterministic checks of one case. Never calls the agent. */
export async function runChecks(
  evalCase: EvalCase,
  run: RunRecord,
  ctx: CheckContext,
): Promise<{ checks: CheckResult[]; board?: TierListImport }> {
  const answer = run.turns.at(-1)?.answer ?? ""
  const expected = evalCase.expect
  const checks: CheckResult[] = []
  if (run.error) checks.push(fail("agent", run.timedOut ? `timed out: ${run.error}` : run.error))
  const down = checkMcpUp(run.toolCalls, answer)
  if (down) checks.push(down)

  if (expected.clarify) {
    checks.push(checkClarify(run.toolCalls, answer), checkLanguage(evalCase.lang, answer), checkToolsClean(run.toolCalls))
    return { checks }
  }

  const { board, reason } = await resolveFinalBoard(run.toolCalls, ctx)
  checks.push(checkLink(board, reason), await checkPng(run.toolCalls, ctx), checkFresh(run.toolCalls))
  if (board) {
    checks.push(
      checkTiers(board, expected.tiers),
      checkColors(board, expected.tiers?.colors),
      checkItems(board, expected.items),
      checkUnique(board),
      expected.pool_ok ? skip("placed", "pool allowed") : checkPlaced(board),
      checkTemplate(board, run.toolCalls, expected.template, evalCase.prompt),
      await checkImages(board, ctx),
      expected.final ? checkFinal(board, expected.final) : skip("final", "no final-board expectations"),
      expected.images ? await checkImageSource(board, run.toolCalls, expected.images, ctx) : skip("image_source", "pictures not requested"),
    )
  }
  checks.push(
    expected.answer_matches ? checkAnswer(answer, expected.answer_matches) : skip("answer", "no answer expectations"),
    checkLanguage(evalCase.lang, answer),
    checkLinks(answer, run.toolCalls),
    checkToolsClean(run.toolCalls),
  )
  return { checks, board }
}

export const casePassed = (checks: CheckResult[]) => checks.every((check) => check.status !== "fail")
