export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

export type ImageVerdict = { ok: boolean; reason?: string }

const isImage = (type: string | null) => (type ?? "").toLowerCase().startsWith("image/")

/**
 * A URL is a real image when it answers 200 with an image/* type and a body of at most `maxBytes`.
 * HEAD is tried first (cheap); anything inconclusive falls back to a GET whose body is read through
 * a byte counter and abandoned as soon as the limit is crossed.
 */
export async function checkImageUrl(url: string, fetchImpl: typeof fetch = fetch, maxBytes = MAX_IMAGE_BYTES): Promise<ImageVerdict> {
  const request = (method: "HEAD" | "GET") =>
    fetchImpl(url, { method, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "tiermaker-ru-mcp-evals" } })
  try {
    const head = await request("HEAD").catch(() => undefined)
    const declared = Number(head?.headers.get("content-length") ?? NaN)
    if (head?.status === 200) {
      if (!isImage(head.headers.get("content-type"))) return { ok: false, reason: `content-type ${head.headers.get("content-type") ?? "none"}` }
      if (declared > maxBytes) return { ok: false, reason: `image is ${declared} bytes, limit ${maxBytes}` }
    }
    const response = await request("GET")
    if (response.status !== 200) return { ok: false, reason: `HTTP ${response.status}` }
    if (!isImage(response.headers.get("content-type"))) return { ok: false, reason: `content-type ${response.headers.get("content-type") ?? "none"}` }
    const length = Number(response.headers.get("content-length") ?? NaN)
    if (length > maxBytes) {
      void response.body?.cancel()
      return { ok: false, reason: `image is ${length} bytes, limit ${maxBytes}` }
    }
    const reader = response.body?.getReader()
    let total = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        void reader.cancel()
        return { ok: false, reason: `image body is larger than ${maxBytes} bytes` }
      }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
