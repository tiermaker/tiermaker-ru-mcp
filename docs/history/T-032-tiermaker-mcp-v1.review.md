# T-032 review — tiermaker-mcp v1

## Вердикт: FAIL

| Критерий | Статус | Доказательство |
| --- | --- | --- |
| `npm ci && npm run lint && npm test && npm run build` в контейнере | ok | Docker `node:22` с изолированным томом зависимостей: lint, 39/39 Vitest и build прошли. |
| Совместимость в обе стороны | ok | Сайт в dev-контейнере закодировал новую доску через `encodeTierListImport`; `dist/codec.js` MCP декодировал её без потерь. Ссылка из фактического MCP stdio-smoke открылась в dev-редакторе. `test/compat.test.ts:17-28` также проверяет 3 пары фикстур. |
| Smoke create → set_tiers → add_items → place_items → render_image → get_editor_link и ссылка на dev | ok | Скриптовый stdio-клиент прошёл весь поток; PNG — 25 873 байта. Открытие `http://localhost:3000/create#tm=…` показало заголовок `Tester MCP smoke`, тиры «Шедевр/Хорошо/Так себе», Hades/Zelda/Tetris/Doom по тирам и Portal в пуле. |
| Нет утечек инфраструктуры | ok | `rg -n -i 'legacy-hosting|/Users/|ssh|\\.team' --hidden -g '!node_modules/**' -g '!.git/**' .` — пустой вывод. |
| Лимиты и PNG | ok | Зелёный `test/tools.test.ts:185-200` покрывает 21 тир и `javascript:`/`data:` URL; `test/render.test.ts:27-43` проверяет PNG-сигнатуру и размер. |

## Actionable findings

1. **P1 — цвет тира меняется при открытии ссылки.** `src/schema.ts:32-39` принимает и прямо предлагает `red`, поэтому `update_tier(..., { color: "red" })` успешно помещает его в payload. Рендер MCP покажет красный, но редактор принимает только hex/rgb/hsl; `frontend/lib/tier-colors.ts:25-29` преобразует `red` в fallback `#6b7280`. Воспроизведение: Docker-скрипт с `BoardStore().create("Color"); updateTier(board, "S", { color: "red" })` выводит `{ "color": "red" }`; после открытия ссылки тир серый. Привести `assertColor` к `isCssTierColor` сайта (либо к общему переносимому подмножеству) и добавить compatibility-test. Заодно решить поддержку site-цветов вида `bg-red-600`: сайт их маппит (`frontend/lib/tier-colors.ts:3-19`), а MCP сейчас отвергает.

2. **P2 — публичная схема сообщает неверный лимит текста.** `docs/tierlist-import-v1.md:30` указывает 120 символов, но MCP и канонический сайт допускают 128 (`src/schema.ts:6,42-45`; `frontend/lib/content-rules.ts:1`). Исправить документацию на 128, чтобы контракт не расходился с реализацией.

## Круг 2

### Вердикт: PASS

| Критерий | Статус | Доказательство |
| --- | --- | --- |
| P1 из круга 1: цвета ссылок совпадают с редактором | ok | `src/schema.ts:33-93` нормализует имена и site-классы в hex, а неподдерживаемые значения отвергает. Контейнерная проба: `red → #ef4444`, `bg-red-600 → #dc2626`, `hotpink` отклонён; dev `resolveTierColor` возвращает эти hex без fallback. `test/colors.test.ts:13-31` покрывает путь инструмента до payload. |
| P2 из круга 1: лимит текста в документации | ok | `docs/tierlist-import-v1.md:30` и последний коммит сайта `689dc49` в `frontend/lib/tierlist-import.md:30` указывают 128. `test/limits.test.ts:18-22` фиксирует контракт MCP-документации. |
| Контейнерный gate | ok | `docker run … node:22 sh -lc 'npm ci && npm run lint && npm test && npm run build'`: lint, 46/46 Vitest и build прошли. |
| Совместимость и отсутствие утечек из круга 1 | ok | `test/compat.test.ts` расширен цветовой фикстурой; `git show --check 39b3df6` и проверка `rg` по репозиторию — без замечаний. |

Actionable-находок нет.
