# T-035 review — FAIL

Проверены все коммиты поставки `52f10c2^..abcdb31` в `tiermaker-mcp` и отчёт кодера `T-035-mcp-evals.report.md`. Полный eval намеренно не повторялся.

| Критерий | ok/нет | Доказательство |
| --- | --- | --- |
| 20 кейсов покрывают заданные категории | ok | `evals/cases.yaml:3-172`: 20 ID, включая simple, custom, template, no-template, exact, edit, arrangement, limits, images, ambiguous. |
| Агентский runner сохраняет результат, вызовы, ответ, PNG и ссылку; есть `--case` | ok | `evals/run.ts:64-110`; README Evals. Выборочный запуск `npm run eval -- --case ambiguous-favorites-en --case arrange-en --no-judge --label tester-review` создал `evals/results/20261025-064318-tester-review/`. |
| Детерминированные проверки выполняют все заявленные проверки картинок и языка | **нет** | `evals/run.ts:45-61` не имеет лимита тела ответа картинки; `evals/checks.ts:221-228` допускает URL/code-only ответ как английский. |
| Правки второго хода, шаблоны, ссылки/PNG, tiers/items/duplicates/pool и ошибки tools проверяются на фикстурах | ok | `test/evals-checks.test.ts`; Docker Node 22: `npm test -- test/evals-checks.test.ts` — 12/12. |
| LLM-судья и summary с категорными метриками/сравнением | ok | `evals/judge.ts`, `evals/report.ts`; `evals/example-summary.md:5-45,80`. |
| Полный прогон и summary приложены; report содержит метрики, стоимость и топ-проблемы | ok | `evals/example-summary.md:5-82`; `.team/tasks/T-035-mcp-evals.report.md:6-20` (19/20, $1.86). |
| Docker lint/test/build | ok | Docker Node 22: `npm run lint && npm run build` — pass; focused checks tests — 12/12. |

Выборочные case-прогоны не проверили пользовательский сценарий: оба остановились после `Skill` с `CONNECTION_CLOSED` у MCP (`arrange-en`: нет link/PNG; `ambiguous-favorites-en`: clarify без `?`). Это не засчитано как повтор полного прогона и не позволяет опровергнуть приложенный полный summary.

## Actionable findings

1. **P1 — `evals/run.ts:45-61`: проверка URL картинки не ограничивает размер ответа.**
   Требование требует HEAD/GET с лимитом, но `fetch` делает GET без проверки `Content-Length` и без чтения потока со счётчиком байтов; `response.body.cancel()` только запрашивает отмену уже начатой загрузки. URL с `image/*` и бесконечным/чрезмерным телом может быть признан валидным. Сделать HEAD с проверкой размера и fallback GET, который прекращает чтение после явного лимита; добавить fixture-тест для oversized/chunked image.

2. **P1 — `evals/checks.ts:221-228`: language-check пропускает ответ без прозы.**
   `prose()` удаляет все URL и inline-code, после чего пустая строка имеет 0% кириллицы и проходит как английский. Вызов `runChecks` для EN-кейса с ответом только `` `file.png` https://… `` даст `language: pass`, хотя язык ответа не установлен. После очистки требовать хотя бы одну букву (или достаточный объём прозы) и покрыть этот случай unit-тестом.

3. **P1 — `evals/agent.ts:67-89`: обрыв MCP до первого tool call не становится ошибкой прогона.**
   В выборочном запуске оба `result.json` содержат только успешный `Skill`, `run.error` пуст и `tools_clean` проходит, хотя финальный ответ сообщает `tiermaker MCP server failed to connect (CONNECTION_CLOSED)`. Для clarification-кейса такой сбой потенциально даст ложный PASS. Сохранять/разбирать события инициализации MCP либо явно помечать отсутствие доступных `mcp__tiermaker__` после запуска skill как infrastructure error; добавить тест stream-транскрипта.

Примечание: в текущем worktree уже был не относящийся к задаче untracked-каталог `.playwright-mcp/`; не изменялся.

## Круг 2 — PASS (commit `3cc40d1`)

| Пункт прошлого FAIL | Результат | Доказательство |
| --- | --- | --- |
| Лимит тела image URL | ok | `evals/images.ts:13-45`: HEAD и потоковый GET с пределом 5 MB; unit-тест проверяет oversized `Content-Length` и chunked бесконечный поток. |
| Язык не может быть установлен по URL/code-only ответу | ok | `evals/checks.ts:221-232` требует минимум 5 букв прозы; `test/evals-checks.test.ts:214-223` проверяет EN и RU link-only ответы. |
| Недоступный MCP не должен давать ложный PASS | ok | `evals/preflight.ts:6-34` запускает MCP и вызывает `listTools` до агента; `evals/agent.ts:65-73` фиксирует неудачную init-сессию; `evals/checks.ts:259-280` помечает `CONNECTION_CLOSED` как fail. Unit-тесты покрывают оба пути. |
| Один реальный case по host-инструкции README | ok | По README создана host-копия `/tmp/tiermaker-mcp-host.3Hv9bt`, выполнены `npm ci`, build, eval TypeScript; `EVAL_MCP_ENTRY=/tmp/tiermaker-mcp-host.3Hv9bt/dist/index.js node dist-evals/evals/run.js --case arrange-en` — PASS 1/1, 8 calls, 16 s, все deterministic checks и judge 5/5/5/5. |
| Focused unit/lint | ok | Docker Node 22: `npm test -- test/evals-checks.test.ts` — 16/16; `npm run lint` — pass. |

Полный прогон не повторялся по инструкции. Новых actionable-замечаний к `3cc40d1` нет.
