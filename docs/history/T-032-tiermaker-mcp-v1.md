# T-032: MCP-сервер tiermaker-mcp v1 (новый репо, локально)

## Цель
Новый OSS-репо `tiermaker-mcp`: агент через MCP собирает тир-лист (структура + содержимое), получает PNG и ссылку
`https://tiermaker.ru/create#tm=…`, открывающую доску в редакторе как гостевой черновик. Без авторизации и без записи на сервер.
Только локально: без GitHub, без npm-публикации.

## Контекст
- План: `.team/tasks/mcp-v1-plan.md`. Формат и лимиты: `frontend/lib/tierlist-import.ts`, `frontend/lib/tierlist-import.md`
  (сжатие — CompressionStream `"deflate"` = zlib/RFC1950 → в Node `zlib.deflateSync`), тесты `frontend/tests/unit/tierlist-import.test.ts`.
- Публичные GET каталога: `.team/tasks/T-030-mcp-recon.notes.md` п.3 (`/api/templates/catalog/`, `/api/templates/by-slug/{slug}/`, `/api/categories/`).

## Где
`<local-path> — новая папка, `git init`, ветка `main`, без remote.
Сборка и тесты — в Docker (`docker run --rm -v <папка>:/app -w /app node:22 …`), не на хосте.
В репо не должно быть упоминаний Legacy hosting, путей `/Users/…`, ssh, IP, `.team` — это публичный код.

## Что сделать
1. TypeScript, `@modelcontextprotocol/sdk` (stdio), `bin: tiermaker-mcp` (`npx tiermaker-mcp`), MIT, Node ≥ 20. Минимум зависимостей.
2. Модель доски и валидатор — те же поля и лимиты, что `TierListImport v1` (≤ 20 тиров, ≤ 200 элементов, ≤ 32 КБ сжатого payload, imageUrl только http(s)).
   Состояние досок в памяти процесса (id доски → доска).
3. Инструменты (zod-схемы входа, понятные ошибки, ответ — краткий JSON доски):
   `search_templates(query, category?, limit?)`, `get_template(slug)`, `list_categories()`;
   `create_tierlist(title, tiers?, template_slug?)` (дефолт S/A/B/C/D с цветами сайта; из шаблона — его элементы в пул);
   `set_tiers(board_id, tiers[])`, `update_tier(board_id, tier_id, label?, color?, position?)`, `remove_tier`;
   `add_items(board_id, items[{label?, image_url?}])`, `update_item`, `remove_items`;
   `place_items(board_id, {tier_id: item_ids[]})` (порядок = порядок в массиве; остальные не трогать), `move_item(board_id, item_id, tier_id|"pool", position?)`;
   `get_tierlist(board_id)`; `render_image(board_id, output_path?)` → PNG (satori+resvg или аналог; картинки качать с таймаутом 8 с и лимитом 5 МБ, при ошибке — плейсхолдер с подписью);
   `get_editor_link(board_id)` → ссылка; если payload > лимита — записать `<title>.tierlist.json` и вернуть путь + инструкцию «Импорт из файла».
   `export_json(board_id, output_path?)`.
4. Конфиг: `TIERMAKER_BASE_URL` (по умолчанию `https://tiermaker.ru`), User-Agent `tiermaker-mcp/<версия>`.
5. Совместимость: тестовые векторы — payload, созданный MCP, декодируется кодом сайта. Скопировать 2–3 фикстуры: MCP-encode → прогнать через `decodeTierListImport` сайта в frontend-контейнере (одноразовый скрипт, результат в отчёт) и наоборот.
6. Тесты (vitest): каждый инструмент, лимиты, порядок размещения, pool, encode/decode round-trip, рендер PNG (размер > 0, валидная сигнатура). Сеть мокать — тесты не ходят на tiermaker.ru.
7. README (EN + краткий RU): что это, установка в Claude Code / Claude Desktop / Cursor (JSON-конфиги), список инструментов, пример диалога, лимиты, приватность (ничего не сохраняется на сервере). `LICENSE`, `CHANGELOG.md`, `.github/workflows/ci.yml` (lint+test+build), `SECURITY.md`. Схему скопировать в `docs/tierlist-import-v1.md`.

## Не делать
- Не создавать GitHub-репо, не пушить, не публиковать в npm. Не менять код сайта.
- Не ходить на прод из тестов. Ручной smoke к прод-каталогу — максимум 3 GET-запроса без прокси Mac.

## Критерии приёмки
- `npm ci && npm run lint && npm test && npm run build` в контейнере зелёные.
- Совместимость с сайтом подтверждена в обе стороны.
- Smoke через MCP Inspector или скриптовый stdio-клиент: create → set_tiers → add_items → place_items → render_image → get_editor_link; ссылка с dev-хостом (`TIERMAKER_BASE_URL=http://localhost:3000`) открывается в редакторе на dev с нужными тирами и элементами (скриншот/описание).
- `rg -i 'legacy-hosting|/Users/|ssh|\.team'` по репо — пусто (кроме .gitignore при необходимости).
- Отчёт `.team/tasks/T-032-tiermaker-mcp-v1.report.md` в этом (сайтовом) репо; коммиты в новом репо.

## Проверки (тестер)
- Сборка/тесты в контейнере; повторить smoke; проверить ссылку на dev; grep на утечки инфраструктуры; лимиты (201 элемент, 21 тир, `javascript:` URL) → понятная ошибка.

## Прод: нет
