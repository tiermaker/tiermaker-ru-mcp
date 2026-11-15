---
name: tiermaker
description: Build a tier list with the tiermaker MCP tools and hand back a PNG plus a link that opens it in the TierMaker editor. Use when the user asks for a tier list, a ranking by tiers (S/A/B/C/D), "сделай тир-лист", "рейтинг по тирам", or wants items sorted into tiers on any topic.
---

# Making tier lists with TierMaker

Requires the `tiermaker` MCP server (`tiermaker-mcp`). Tools: `search_templates`, `get_template`,
`list_categories`, `create_tierlist`, `set_tiers`, `update_tier`, `remove_tier`, `add_items`,
`update_item`, `remove_items`, `place_items`, `move_item`, `get_tierlist`, `render_image`,
`get_editor_link`, `export_json`, `search_images`. `get_editor_link` saves the board on the site for 180 days (anyone with the link can open it); before that, stdio boards live in memory; HTTP boards persist seven days after the last edit. Board IDs and links grant access: keep them private.

**Language: write every reply in the language of the user's request, even when the template, its items
or the tool results are in another language.** An English request about a template with Russian
titles still gets an English answer (and the other way round). Always finish by placing every item (nothing left unplaced).

## Workflow

1. **Topic.** If the request names no topic at all, ask once. Otherwise do not ask questions — pick
   sensible defaults and offer to adjust at the end.
2. **Template.** Call `search_templates` with 1–2 short queries (try the topic in English and in the
   user's language). If a result clearly matches the topic, use `create_tierlist(title, template_slug=…)`;
   its items land in the pool (check `skipped_template_items`). If the user named a template slug, use it.
   No good match → plain `create_tierlist`. Don't force a poor match.
3. **Tiers.** Default is S, A, B, C, D (what `create_tierlist` gives). If the user asked for custom
   tiers ("must watch / maybe / skip"), pass them as `tiers` (or `set_tiers`), best first, in the user's
   language, optionally with `color`. Keep 3–7 tiers unless asked otherwise.
4. **Items.** Aim for 10–40 (fewer only if the topic is naturally small; max 200). Use the template's
   items when there are any; add more with `add_items` only if the user wants them. Use
   short labels (≤ 128 chars, ideally 1–4 words). Do not add duplicates.
   If the user asks for more than 200, do **not** split it into several boards: build one board of
   ≤ 200 and offer to narrow it or split by a criterion (era, genre, group) in a follow-up.
   Before placing, check the list for obvious and recent omissions (new releases, famous members of
   the topic) and add them **before** `place_items`, so one call places everything. If you add items
   after placing, place those new ids too.
5. **Placement.** Decide each item's tier on a stated criterion (quality, usefulness, popularity —
   whatever fits the topic; for the user's own criterion, use theirs). Place everything with a single
   `place_items` call using the tier ids from the previous result. Spread items over the tiers — avoid
   dumping all into one. Leave an item unplaced only when it cannot be judged.
6. **Check (never skip).** Call `get_tierlist`: all tiers named as intended, no items left in the pool
   (including ones you added after placing), nothing misplaced. Fix with `move_item`/`place_items`.
7. **Deliver.** `render_image` (HTTP: image and `download_url`; stdio: image and local `path`), then `get_editor_link` (its `markdown` goes into the answer as is).

## Images

- When the user wants pictures and the board has items without an image (no template, or a template
  without pictures), you must call `search_images` first (one query per item or group, short
  specific queries, the item name alone for Pokémon) and put the returned `url` into `image_url`. Use `image_url` only for a direct
  `http(s)` link from the user, a template or `search_images`. **Never invent or guess image URLs** — a
  wrong one renders as a placeholder. If no image is found, keep the item text-only (`label`).
- Choose `source` by subject: `pokeapi` for Pokémon (the name only), `anilist` for anime/manga and their
  characters, `coverart` for albums, `openlibrary` for books, `wikidata` for named people, places, brands
  and logos, `commons` for generic photos. Without a clear fit use `auto` (optionally with `topic`).
  An explicit `source` never falls back: if its answer is empty with a `note` saying it is unavailable, repeat
  the search with `source=auto`.
- Results carry `license` (free files, credit `attribution`) or `rights: "copyrighted, used by reference"`
  (artwork, covers). Mention in the answer where the pictures come from; for copyrighted ones say they
  are linked, not licensed. Only use the returned `url`.
- Cards may have both a label and an image.

## Final answer

Reply in the language of the user's request (not the language of the topic, template or item names),
briefly:
- the PNG (remote `download_url` or local file path; the image is also returned by the tool) and the editor link: the `markdown` line from `get_editor_link` (`[Открыть в редакторе](…)`) pasted **verbatim, once** — never retype, shorten, translate or re-wrap the url (one wrong character opens another board). For stdio, mention `link_file` as a backup when present; for HTTP, use the returned download URL without inventing filesystem paths;
- one line naming the ranking criterion, and at most two lines on notable placements;
- an offer to change tiers, move items or add/remove some.
Do not paste the whole board as text again.

## When something goes wrong

- Tool errors are plain-text messages (unknown id, limit exceeded, invalid color or URL) — read them,
  fix the arguments and retry once; don't repeat the same failing call.
- Limits: 20 tiers, 200 items, 128 characters of text, tier colors must be ones the editor supports.
- `get_editor_link` may return a long `#tm=` link plus a `note` when the short link could not be created: use it the same way, and tell the user in one short line that the board was not saved on the site.
- `get_editor_link` returns `file` + `instructions` instead of `url` when the board is too big for a
  link: give the user the returned `download_url` (HTTP) or `.tierlist.json` path (stdio) and tell them to open the editor and use "Import from
  file".
- `search_templates` / `get_template` failing (site unreachable): continue without a template.
- A card image that cannot be downloaded shows a placeholder in the PNG; mention it if it matters.
- Stdio IDs expire at process exit. HTTP IDs survive restart and expire seven days after the last edit. On expiry create a new board. On overload retry later with the same board ID.
