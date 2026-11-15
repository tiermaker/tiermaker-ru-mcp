import { USER_AGENT } from "./config.js"
import { MAX_ITEMS, MAX_TEXT_LENGTH, fail } from "./schema.js"
import type { ItemInput } from "./board.js"

export type Fetch = typeof fetch

const REQUEST_TIMEOUT_MS = 10_000

export type TemplateSummary = {
  slug: string
  title: string
  description: string
  category?: string
  item_count: number
  tags: string[]
}

export type TemplateDetail = TemplateSummary & { items: Array<{ name: string; image_url?: string }> }

type Json = Record<string, unknown>

export class Catalog {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async getJson(path: string): Promise<Json> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      return fail(`Could not reach the TierMaker catalog at ${this.baseUrl}. Check your connection.`)
    }
    if (response.status === 404) fail("Not found in the TierMaker catalog.")
    if (!response.ok) fail(`The TierMaker catalog answered with HTTP ${response.status}.`)
    try {
      return (await response.json()) as Json
    } catch {
      return fail("The TierMaker catalog returned an unreadable response.")
    }
  }

  private summarize(raw: Json): TemplateSummary {
    const category = raw.category as { name?: string; slug?: string } | null | undefined
    return {
      slug: String(raw.slug ?? ""),
      title: String(raw.title ?? ""),
      description: String(raw.description ?? ""),
      ...(category?.slug ? { category: category.slug } : {}),
      item_count: Number(raw.itemCount ?? 0),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    }
  }

  async search(query: string, category?: string, limit = 10): Promise<TemplateSummary[]> {
    const params = new URLSearchParams({ q: query })
    if (category) params.set("category", category)
    const data = await this.getJson(`/api/templates/catalog/?${params}`)
    const items = Array.isArray(data.items) ? (data.items as Json[]) : []
    return items.slice(0, limit).map((item) => this.summarize(item))
  }

  async getTemplate(slug: string): Promise<TemplateDetail> {
    const data = await this.getJson(`/api/templates/slug/${encodeURIComponent(slug)}/`)
    const rawItems = Array.isArray(data.items) ? (data.items as Json[]) : []
    const items = rawItems.map((item) => {
      const image = item.image as { filePath?: string } | null | undefined
      const imageUrl = this.absolute(image?.filePath)
      return { name: String(item.name ?? ""), ...(imageUrl ? { image_url: imageUrl } : {}) }
    })
    return { ...this.summarize(data), items }
  }

  async listCategories(): Promise<Array<{ slug: string; name: string; description: string; template_count: number }>> {
    const data = await this.getJson("/api/categories/")
    const items = Array.isArray(data.items) ? (data.items as Json[]) : []
    return items.map((item) => ({
      slug: String(item.slug ?? ""),
      name: String(item.name ?? ""),
      description: String(item.description ?? ""),
      template_count: Number(item.templateCount ?? 0),
    }))
  }

  private absolute(path: string | undefined): string | undefined {
    if (!path) return undefined
    if (/^https?:\/\//i.test(path)) return path
    if (path.startsWith("/")) return `${this.baseUrl}${path}`
    return undefined
  }
}

/** Template cards that can be put on a board (at most MAX_ITEMS; extra ones are reported as skipped). */
export function templateItems(template: TemplateDetail): { items: ItemInput[]; skipped: number } {
  const usable = template.items
    .map((item) => ({
      ...(item.name.trim() ? { label: item.name.trim().slice(0, MAX_TEXT_LENGTH) } : {}),
      ...(item.image_url ? { image_url: item.image_url } : {}),
    }))
    .filter((item) => item.label || item.image_url)
  return { items: usable.slice(0, MAX_ITEMS), skipped: Math.max(0, usable.length - MAX_ITEMS) }
}
