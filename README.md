# TierMaker.ru MCP

Create a tier list in a conversation, change the ranking, receive PNG and JSON,
and continue in the editor at **https://tiermaker.ru**. Independent project;
not affiliated with tiermaker.com. MIT, TierMaker.ru contributors.

## Run from source / Установка из исходников

Node.js >=22.13. npm publication is not a prerequisite and is not claimed.

```sh
git clone https://github.com/tiermaker/tiermaker-ru-mcp.git
cd tiermaker-ru-mcp
npm ci
npm run build
node dist/index.js
```

Stdio configuration (use your absolute checkout path):

```json
{"mcpServers":{"tiermaker-ru":{"command":"node","args":["/absolute/path/tiermaker-ru-mcp/dist/index.js"]}}}
```

For a remote single-replica server with persistent SQLite:

```sh
mkdir -p data
PUBLIC_URL=https://mcp.tiermaker.ru DB_PATH=./data/boards.sqlite npm run start:http
```

Connect clients using Streamable HTTP at `https://mcp.tiermaker.ru/mcp`, no auth.
This is the intended public address; deployment and client acceptance status is
recorded in [publication status](docs/publication-status.md). Production image:
`docker build -t tiermaker-mcp:local .`. Infrastructure lives in the CLO repo.

## Возможности

Создайте тир-лист с нуля или из каталога, добавляйте карточки и картинки,
перемещайте их по уровням, получите PNG и ссылку редактора tiermaker.ru.
Примеры: «Создай тир-лист напитков: чай в S, кофе в A», затем «Перенеси кофе в S».
English: “Rank tea and coffee, put tea in S and coffee in A, show a PNG.”

Tools: `search_templates`, `get_template`, `list_categories`, `search_images`,
`create_tierlist`, `set_tiers`, `update_tier`, `remove_tier`, `add_items`,
`update_item`, `remove_items`, `place_items`, `move_item`, `get_tierlist`,
`render_image`, `get_editor_link`, `export_json`. Names and
[TierListImport v1](docs/tierlist-import-v1.md) remain compatible.

## Retention and limits / Хранение и ограничения

HTTP boards survive restarts for **7 days after the last edit**. Token holders
can access the board: keep IDs private. Files use independent random links valid
for **24 hours**. Editor links use separate site drafts retained **180 days**;
if the site rejects the save, the tool returns a full `#tm=` link. Oversized links
return downloadable JSON with import instructions. No registration, OAuth, saved
account work or interactive board inside chat. Stdio remains in memory and
supports local `output_path`; HTTP rejects filesystem paths.

Maximum 20 tiers / 200 items, one active render and three waiting; HTTP admits
8 active requests and 120 requests per minute per process. Image downloads are
bounded to 5 MB each, four in parallel; rendered boards use an aggregate 32 MB
image budget and 16 megapixel aggregate decoded budget (4 megapixels per image), with placeholders on failure. Valid raster images are normalized to PNG thumbnails before rendering, including WebP site photos. Image URLs are limited to 2048 characters; stored boards to 512 KiB. JSON-RPC batches are rejected. SQLite is capped at 256 MiB. Overload
returns an error while preserving previously saved board data.

Image search returns source, page URL, license or rights and attribution.
Availability and rights remain dependent on the source. Use `source=auto` for
fallback; explicit unavailable sources return an empty result with a note.

`TIERMAKER_BASE_URL` selects the catalog/editor origin (default tiermaker.ru).
`TIERMAKER_SHORT_LINKS=0` disables sending boards to the site for short links.
HTTP binds loopback by default through the exported startHttp API; the CLI binds
all interfaces for containers. Restrict published ports using the gateway.

## Checks

All project checks run inside the dev container:

```sh
docker compose -f compose.dev.yml run --rm dev npm ci
docker compose -f compose.dev.yml run --rm dev npm run lint
docker compose -f compose.dev.yml run --rm dev npm test
docker compose -f compose.dev.yml run --rm dev npm run build
docker compose -f compose.dev.yml run --rm dev npm pack --dry-run
```

[Security](SECURITY.md) · [Privacy](docs/privacy.md) ·
[Submission and acceptance](docs/publication-status.md) ·
[Changelog](CHANGELOG.md). GitHub Issues is the support channel after publication.
