# Changelog

## Unreleased

- Add stateless Streamable HTTP with persistent SQLite, seven-day edit retention, independent 24-hour PNG/JSON downloads, 256-bit access tokens and transactional edits. Keep local stdio and TierListImport v1.
- Add strict remote inputs, private-address/redirect/socket-DNS protection, bounded compressed/decoded images, board/URL sizes, render/source queues, single-message requests, request limits and aggregate metrics. Keep the site draft rate limit and fallback links.
- Normalize validated raster images to bounded PNG thumbnails before rendering: WebP photos from site templates now produce visible pixels. A regression test reproduces the blank-card case; encoded/decoded budgets and SSRF checks remain enforced.
- All tools were exercised end to end over public HTTPS, including live image search with attribution.
- Exclude private acceptance artifacts, data and environment files from Docker build contexts.
- Patch renderer/dimension-parser dependencies and scoped transitive dependencies; full npm audit reports zero vulnerabilities.
- Prepare OSS metadata, bilingual README, privacy/support documentation and manual release archives; tag-triggered npm publishing stays disabled.

Validation for Unreleased: container lint, 129 tests, build, plugin package, npm pack dry-run and npm audit passed. Official catalog acceptance remains pending; see docs/publication-status.md.

## 0.4.0

- `search_images(query, source?, topic?, limit?)` searches more than Commons: `wikidata` (entity image/logo), `pokeapi` (official artwork), `anilist` (covers, characters), `coverart` (MusicBrainz + Cover Art Archive), `openlibrary` (book covers). `auto` picks one source by `topic` or wording and falls back to Commons with a `note`. No API keys.
- Result fields changed: `title`, `source` (now the service name), `page_url`, `license` or `rights` (`copyrighted, used by reference`), `attribution` (was `caption`, `source` = page url, `author`).
- With `source=auto`, `coverart` degrades to Wikidata, then Commons (with a `note`) when MusicBrainz is unreachable or slow (3 s timeouts, ≈ 5 s total); an unreachable service is not retried for 2 minutes. An explicit `source` is never substituted: when it fails the result is empty with a `note` (`<source> недоступен, попробуй source=auto`). Every result has an `attribution`; pictures of pokeapi/anilist/openlibrary are checked for `image/*` (HEAD, cached) before they are returned.
- Polite access: one queue per service (≤ 1 request/s), 8 s timeout, retries with backoff on 429/5xx, 10-minute cache.
- Skill and README: which source to pick, and a section on rights.
- `get_editor_link` saves the board on the site (`POST /api/drafts`, no account) and returns a short `https://tiermaker.ru/s/<id>` link instead of the 700–3600 character `#tm=` one, which agents sometimes mis-copied. The board is kept for 180 days and anyone with the link can open it.
- If saving fails (network, rate limit) the full `#tm=` link is returned with a `note`. `TIERMAKER_SHORT_LINKS=0` turns saving off. Needs a site release that includes `/api/drafts` and `/s/<id>`.

## 0.3.0

- `get_editor_link` also returns a ready `markdown` line (`[Открыть в редакторе](url)`), and writes the url to `<title>.link.txt` next to the PNG (`link_file`). The skill pastes the `markdown` verbatim instead of retyping the long url.
- Dependencies: `zod` 4.6.7, `@modelcontextprotocol/sdk` 1.32.2, `vitest` 5, `yaml` 2.9.1 — `npm audit` reports 0 vulnerabilities.
- Requests identify themselves per the Wikimedia policy: `tiermaker-ru-mcp/<version> (+<homepage>; <issues url>)`, taken from `package.json`.
- npm packaging: `repository`/`homepage`/`bugs`, `mcpName`, `prepublishOnly`, `server.json` for the MCP Registry, release workflow (trusted publishing, on a `v*` tag).

## 0.2.0

- Add `search_images(query, limit?)`: Wikimedia Commons photo search returning direct image URLs, caption, license and author.
- `render_image`: long card captions wrap to up to 3 lines with an ellipsis instead of being clipped.
- Skill: answer in the language of the request, one board of at most 200 items for oversized requests, check for recent omissions, state the ranking criterion in one line, one link, and use `search_images` instead of guessing image URLs.
- Evals: check that the final answer holds at most one link; image cases expect `search_images`.

- Fix `get_template` / `template_slug`: use the site's `/api/templates/slug/<slug>/` route (the old path returned "Not found").
- Add the `tiermaker` agent skill (`skills/tiermaker`) and a README section on installing it.

## 0.1.0

- Initial release: board building tools, template search, PNG rendering, editor link and JSON export.
