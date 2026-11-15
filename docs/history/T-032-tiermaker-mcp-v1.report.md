# T-032 report

Репо: `<local-path> (git init, ветка main, без remote), коммит `26e3563`.

- Сделано: 16 инструментов (каталог, доска, тиры, элементы, place/move, get_tierlist, render_image через satori+resvg, get_editor_link с файловым fallback, export_json), конфиг `TIERMAKER_BASE_URL`, UA `tiermaker-mcp/<версия>`, README EN+RU, LICENSE, CHANGELOG, SECURITY, CI, `docs/tierlist-import-v1.md`.
- Проверки в docker node:22 с чистым `npm ci`: lint, 39 тестов vitest (сеть замокана), build — зелёные.
- Совместимость: 3 фикстуры. MCP-payload → `decodeTierListImport` сайта (frontend-контейнер, одноразовый tsx-скрипт, удалён) — deepEqual OK ×3; payload сайта (`encodeTierListImport`) сохранён в `test/fixtures/site-payloads.json` и декодируется MCP (compat.test.ts).
- Smoke: stdio-клиент → search, create, set_tiers, add_items, place_items, get_tierlist, render_image, get_editor_link с `TIERMAKER_BASE_URL=http://host.docker.internal:3000` (каталог — dev, не прод; на прод запросов не было). Ссылка с хостом localhost:3000 открыта в dev-редакторе (playwright): заголовок «Smoke: любимые игры», тиры Шедевр/Хорошо/Так себе, Hades+Zelda / Tetris / Doom по местам, Portal в пуле. PNG рендерился (кириллица ок, проверен визуально на тестовой доске).
- `rg -i 'legacy-hosting|/Users/|ssh|\.team'` по репо — пусто.
- Решения: лимит текста 128 (как в коде сайта; в docs схемы сказано 120 — расхождение в `frontend/lib/tierlist-import.md`, поправить там); `place_items` для перечисленных тиров заменяет содержимое (пропущенные элементы → в пул), неупомянутые тиры не трогает; цвета в HEX (как на сайте — #dc2626 и т.д.).
- Не делано: GitHub/npm/push (по ТЗ); картинки качаются без SSRF-фильтра (локальный инструмент) — можно ужесточить в T-034.

## Круг 1 (ревью: FAIL → fix), коммит `39b3df6` в tiermaker-mcp
- P1 цвета: `assertColor` теперь принимает ровно синтаксис `isCssTierColor` сайта (hex 3/4/6/8, rgb/rgba, hsl/hsla с теми же правилами). Имена (red, gold, navy… 21 шт.) и классы сайта `bg-red-600` и т.п. нормализуются в hex; остальное (`hotpink`, `var(--x)`, `#12345`…) — ошибка с примером и списком имён. Проверка на сайте (frontend-контейнер, одноразовый скрипт): payload с 10 цветами из MCP декодирован, все цвета сохранены, `isCssTierColor` = true, без fallback. Фикстуры `test/fixtures/colors.{json,payload.txt}` + тест в compat.test.ts, `test/colors.test.ts`.
- P2: в `docs/tierlist-import-v1.md` лимит текста 120 → 128. Сверка всех чисел с `frontend/lib/tierlist-import.ts`: тиры 20, элементы 200, 32 KiB сжатых, 512 KiB распакованных, id 128, цвет 64, slug 160, текст 128 — совпадают; тест `test/limits.test.ts` фиксирует их.
- Проверки в docker: lint, 46 тестов, build — зелёные; grep на утечки пуст.
- Замечание для сайта (не правил): `frontend/lib/tierlist-import.md` всё ещё говорит «120 characters» — надо исправить на 128 отдельной задачей.
