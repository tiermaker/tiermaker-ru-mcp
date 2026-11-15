import { deflateSync, inflateSync } from "node:zlib"
import { USER_AGENT } from "./config.js"
import {
  MAX_COMPRESSED_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  BoardError,
  fail,
  validateTierListImport,
  type TierListImport,
} from "./schema.js"

/** JSON -> zlib (RFC 1950, same as the browser's CompressionStream("deflate")) -> unpadded base64url. */
export function encodePayload(value: unknown): string {
  const board = validateTierListImport(value)
  const compressed = deflateSync(Buffer.from(JSON.stringify(board), "utf8"), { level: 9 })
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    fail(`Board is too large for a link (${compressed.byteLength} bytes compressed, limit ${MAX_COMPRESSED_BYTES}).`)
  }
  return compressed.toString("base64url")
}

export function payloadSize(value: unknown): number {
  return deflateSync(Buffer.from(JSON.stringify(validateTierListImport(value)), "utf8"), { level: 9 }).byteLength
}

export function decodePayload(payload: string): TierListImport {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) fail("Payload is not valid base64url.")
  const compressed = Buffer.from(payload, "base64url")
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) fail("Payload is too large.")
  try {
    const raw = inflateSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES })
    return validateTierListImport(JSON.parse(raw.toString("utf8")))
  } catch (error) {
    if (error instanceof BoardError) throw error
    return fail("Payload could not be decoded.")
  }
}

export function buildEditorLink(baseUrl: string, payload: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/create#tm=${payload}`
}

const SAVE_TIMEOUT_MS = 8_000
const SHORT_ID_RE = /^[0-9A-Za-z]{10}$/

export type SavedDraft = { url: string; expiresAt?: string }

/**
 * Store the board on the site and return its short link, or the reason it was not possible.
 * The caller falls back to the long link, so this never throws.
 */
export async function saveDraft(
  baseUrl: string,
  payload: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; draft: SavedDraft } | { ok: false; reason: string }> {
  const root = baseUrl.replace(/\/+$/, "")
  let response: Response
  try {
    response = await fetchImpl(`${root}/api/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reason: "the site could not be reached" }
  }
  if (response.status === 429) return { ok: false, reason: "the site's limit on saved boards was reached" }
  if (!response.ok) return { ok: false, reason: `the site answered with HTTP ${response.status}` }
  try {
    const body = (await response.json()) as { id?: unknown; expires_at?: unknown }
    if (typeof body.id !== "string" || !SHORT_ID_RE.test(body.id)) return { ok: false, reason: "the site returned an unreadable response" }
    return {
      ok: true,
      draft: { url: `${root}/s/${body.id}`, expiresAt: typeof body.expires_at === "string" ? body.expires_at : undefined },
    }
  } catch {
    return { ok: false, reason: "the site returned an unreadable response" }
  }
}
