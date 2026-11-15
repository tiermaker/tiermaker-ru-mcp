# T-031 review

## FAIL

| Критерий | Статус | Доказательство |
| --- | --- | --- |
| Unit: round-trip, границы, битые payload, duplicate ID, схемы URL, pool | ok | `pnpm exec tsx --test tests/unit/tierlist-import.test.ts`: 9/9 passed |
| Link import: тиры, порядок, цвета, очистка fragment; битая ссылка остаётся работоспособной | ok | `pnpm exec playwright test --project=chromium tests/e2e/editor-import.spec.ts`: 5/5 passed |
| File import/export round-trip | нет | Проверен только случай без `templateSlug`; экспорт в `frontend/app/create/page.tsx:395-400` не передаёт его и теряет привязку опубликованного шаблона. |
| `templateSlug`: опубликованный шаблон связывается, отсутствующий даёт предупреждение | нет | Связь для сохранения есть через numeric `template.id`, но slug не сохраняется для последующего export/import; E2E покрывает только отсутствующий шаблон. |
| Внешние картинки идут через image-proxy | нет | `frontend/lib/tierlist-import.ts:237-242` вызывает общую нормализацию, которая пропускает `s3.ru1.storage.S3 storage` напрямую (`frontend/lib/types.ts:552-568`). |
| Нет передачи fragment на сервер, CSP/зависимости не расширены | ok | Diff `1a40f1f`: hash читается только в client page; `frontend/next.config.mjs`, `frontend/package.json`, `pnpm-lock.yaml` не изменялись. |
| lint, typecheck, predeploy | ok | `pnpm lint` и `pnpm typecheck` прошли (только прежние warnings); запущенный `BACKEND_PYTEST_ADDOPTS=--nomigrations SEED_TEST_REFERENCE_DATA=true make test-predeploy` завершился, также указан зелёным в отчёте. |
| Отчёт содержит пример dev-ссылки и ручную проверку | нет | `.team/tasks/T-031-editor-import-link.report.md:10` прямо фиксирует, что ручная проверка dev-ссылки не выполнена; самой ссылки в отчёте нет. |

## Находки

1. `frontend/app/create/page.tsx:395` — экспорт не сохраняет `templateSlug`. Импортируйте доску с существующим опубликованным `templateSlug`, затем экспортируйте её: в `.tierlist.json` этого поля нет, и следующий импорт уже не привяжется к шаблону. Сохраните slug выбранного published template в состоянии импорта и передайте его в `buildTierListImportFromEditor`; добавьте round-trip E2E с доступным шаблоном.
2. `frontend/lib/tierlist-import.ts:237` — импортированный URL `https://s3.ru1.storage.S3 storage/...` отображается напрямую, поскольку `normalizeImageUrl` делает исключение для этого хоста. Это нарушает требование проксировать внешнюю картинку. Для импортных URL формируйте `/api/image-proxy?url=...` явно (не меняя существующее поведение сохранённых media) и добавьте E2E на этот URL.
3. `.team/tasks/T-031-editor-import-link.report.md:10` — до передачи задачи добавьте проверенную dev-ссылку `/create#tm=...` в отчёт и отметьте её ручную проверку.

## Круг 2 — PASS

| Проверка | Статус | Доказательство |
| --- | --- | --- |
| Находка 1: export/import сохраняет опубликованный `templateSlug` | ok | `765f9e1`: `importedTemplateSlugRef` сохраняет slug только для published template и передаёт его в export; новый E2E `keeps the published templateSlug through a file export round trip` прошёл. |
| Находка 2: прямой URL собственного S3 | ok (решение architect) | Не является провалом: документировано в `frontend/lib/tierlist-import.md` как намеренное исключение для CSP-разрешённого собственного S3-хоста. |
| Находка 3: dev-ссылка и её проверка в отчёте | ok | `56741ff`: в `.team/tasks/T-031-editor-import-link.report.md` добавлены localhost-ссылка и результат Chromium-проверки. |
| Регрессия import workflow | ok | `pnpm exec playwright test --project=chromium tests/e2e/editor-import.spec.ts`: 6/6 passed; `pnpm typecheck`: passed. |

Новых actionable-замечаний по `765f9e1` и `56741ff` нет.
