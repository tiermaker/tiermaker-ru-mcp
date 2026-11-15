# TierListImport v1

`TierListImport` is a portable board format for opening a board in the TierMaker editor or importing it from a `.tierlist.json` file. Imported boards stay local drafts until the user saves them.

## Schema

```ts
type TierListImport = {
  version: 1
  title: string
  templateSlug?: string
  tiers: Array<{ id: string; label: string; color: string }>
  items: Array<{ id: string; label?: string; imageUrl?: string }>
  placements: Record<string, string[]>
}
```

- `version` is always `1`.
- `title` is shown in the editor.
- `templateSlug` is optional. The editor links it only when the template exists and is published.
- `tiers` gives row order. Tier IDs are unique; `color` is a CSS color supported by the editor.
- `items` gives every card once. A card must contain a `label`, an `imageUrl`, or both.
- `placements` maps a tier ID to ordered item IDs. Omit an item to leave it in the pool. An item can occur in no more than one tier.

Unknown fields and invalid references are rejected rather than guessed.

## Limits and image URLs

- At most 20 tiers and 200 items.
- Titles, tier labels, and item labels are limited to 128 characters.
- IDs are at most 128 characters; `templateSlug` is at most 160 characters.
- Link payloads are limited to 32 KiB after compression.
- `imageUrl` must be an absolute `http:` or `https:` URL. `data:`, `javascript:`, relative URLs, and other schemes are rejected.

External images are shown through the editor image proxy. Saving an imported draft after sign-in follows the normal image-saving path.

## Example file

```json
{
  "version": 1,
  "title": "Пример",
  "tiers": [{ "id": "top", "label": "Лучшее", "color": "#ef4444" }],
  "items": [{ "id": "apple", "label": "Яблоко" }],
  "placements": { "top": ["apple"] }
}
```

Save JSON as `example.tierlist.json` and choose **«Импорт из файла»** in the editor. Exported files use this schema.

## Editor link

Encode UTF-8 JSON with `deflate`, then unpadded base64url; append it as a fragment. Fragments are not sent to the server.

```text
https://tiermaker.ru/create#tm=eJxNjbEKwjAURf_lumYRMr1fKR1qfUIgbUIaXEKh4KD_4NBPEIeCqPQbXv5IWhy6Xs45N-HMoTOuBe0VoomWQZAxD_KSr0x5wDJz6EBFgjmCEJ2Hgq0ObBf2ni_5mm8yyQSF2lkXQNjxSWut0ZcKJnKz8SvvLW8LD3nKR2Z5y7zy3lY1N9zGDpTWOyr-Vtn3PxryRuc
```

## Image hosts

Imported `imageUrl` values go through the same image normalization as the rest of the site. Our own S3 host is allowed by the CSP and is shown directly (not via `/api/image-proxy`); this is intentional. Other hosts are shown through the proxy.
