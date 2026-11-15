# T-037 — ревью тестера

**Вердикт: FAIL.** Проверен итоговый `tiermaker-mcp` commit `46ec759` (накопленный diff `9fedb89..46ec759`). Полные evals повторно не запускались: использованы сохранённые run3/run5.

| Критерий / требование ТЗ | ok | Доказательство |
|---|---:|---|
| Docker lint, test, build; audit без high/critical | да | Чистые `node:20` и `node:22`: `npm ci && npm run lint && npm test && npm run build && npm audit --audit-level=high`; по 76 tests, audit: 0 vulnerabilities. Node 20 выдаёт только warning `vitest@5` engine, проверки проходят. |
| tgz ставится и работает через `npx` на Node 20/22 | да | В чистых контейнерах: `npm pack`, затем `npx -y ./tiermaker-mcp-0.3.0.tgz`; скриптовый MCP-клиент получил 17 tools и выполнил `create → add → render → get_editor_link`, PNG и `.link.txt` существуют. |
| Состав пакета без тестов/evals/results/секретов | да | tgz: 16 файлов, 22.9 kB: LICENSE, README, CHANGELOG, package.json, server.json, docs, skills и 9 `dist/*.js`; `tar -tzf` и content grep на `legacy-hosting|ssh|/Users/|.team|secret|token|gmail` — пусто. `dist/index.js` имеет shebang. |
| Версия, зависимости, UA, npm-метаданные, registry manifest, CI, README/CHANGELOG | да | `package.json`, `src/config.ts`, `server.json`, `.github/workflows/release.yml`, README и CHANGELOG в `9fedb89..46ec759`; zod 4.6.7, SDK 1.32.2, OIDC workflow без токена. |
| Markdown и файл ссылки | да | `src/tools.ts:241-256`, тесты `test/tools.test.ts:219-236`: возвращаются `url`, точный `markdown`, `.link.txt` рядом с PNG. |
| `resource_link`/structured content при поддержке клиентом | нет | `46ec759`, `src/tools.ts:253-255` всегда возвращает только текстовый JSON; единственный `resource_link` намеренно удалён. Возможности клиента не учитываются, поэтому условная часть п.1 ТЗ не выполнена. |
| 2 eval-прогона: 0 искажённых ссылок | **нет (отдельный известный дефект)** | run3 `notemplate-anime-ru`: URL инструмента 808 символов, в ответе 807; первое расхождение на символе 566 (1-based): ожидался `-`, получен `y`. run5: 0 искажений. |
| Остальное не хуже fix2, кроме Pokémon/Commons | нет | run3: после известной ссылки остаётся только допустимый `images-pokemon-en`. В run5, помимо допустимого Pokémon, упал `ambiguous-favorites-en` (`clarify`: «answer asks nothing»); это новый неоговорённый случай относительно fix2. Оба summary показывают 18/20, но run5 не соответствует этому условию по составу провалов. |
| Ручной Claude Code тест во временном, не глобальном конфиге | да | Временный `/private/tmp/t037-claude.7EuYVi/.mcp.json` создан через `claude mcp add --scope project`, затем сервер удалён; глобальный конфиг не менялся. Через него созданы 2 доски; ссылки из `.link.txt` (270 и 280 символов) открывают `http://localhost:3000/create` (HTTP 200). Первый ответ Claude дословно вернул `markdown`; архив подключён относительным `./tiermaker-mcp-0.3.0.tgz` через временный shell wrapper. |

## Метрики URL в сохранённых evals

Из `link.json` (по 18 кейсов, где был вызван `get_editor_link`): run3 — медиана **685.5**, максимум **3576** символов (`limit-300-en`); run5 — медиана **676**, максимум **3590** (`limit-300-en`). Искажение — только run3 `notemplate-anime-ru` (808 → 807, выпал `-`).

## Actionable findings

1. `src/tools.ts:253-255` — реализовать выдачу `resource_link`/structured content для клиентов, которые её поддерживают (не удалять её без capability-aware альтернативы); сейчас требование ТЗ полностью отсутствует.
2. `skills/tiermaker/SKILL.md:55-58` (и/или инструкция для ambiguous flow) — добиться однозначного вопроса в `ambiguous-favorites-en`; run5 должен перестать падать по `clarify`, иначе «остальное не хуже fix2» не подтверждается.
3. Отдельно от двух находок: нужен способ, исключающий перепечатывание длинного URL моделью. Текущий `markdown` и `.link.txt` снизили риск, но не обеспечили требуемый 0/2: run3 всё ещё исказил ссылку.
