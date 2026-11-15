# T-037: tiermaker-mcp — подготовка к выкладке (без публикации)

## Цель
Довести MCP до состояния «можно публиковать в npm»: устойчивая ссылка, обновлённые зависимости, пакет проверен
установкой «как у пользователя». Пользователь 2026-10-26: T-036 принят, «протестируем перед выкладкой». Публикации нет.

## Контекст
- Репо `<local-path> (HEAD `9fedb89`, v0.2.0).
- `.team/tasks/T-036-mcp-quality-pack.{report,review}.md` — искажение ссылки агентом (edit-en-disney), троттлинг Commons.
- Эвалы — как в `.team/notes.md` (host-копия, `EVAL_MCP_ENTRY`, Mac на питании).

## Что сделать
1. **Ссылка без пересказа моделью**: `get_editor_link` дополнительно пишет ссылку в файл (`<title>.link.txt` рядом с PNG) и отдаёт
   готовую markdown-строку `[Открыть в редакторе](…)`; SKILL.md — вставлять её дословно, не перепечатывать. Если клиент умеет
   `resource_link`/structured content — использовать. Цель: в 2 прогонах эвалов 0 провалов «ссылка искажена».
2. **Зависимости**: zod ≥ 4.6.6 (и `@modelcontextprotocol/sdk` до совместимой свежей версии), `npm audit` без high/critical.
3. **Wikimedia**: User-Agent по их политике — `tiermaker-mcp/<версия> (+<URL репо>; <контакт>)`; контакт и URL репо — из
   `package.json` (`homepage`, `bugs`), не хардкод email. Значения: `https://github.com/tiermaker/tiermaker-mcp`.
4. **package.json для npm**: `name: tiermaker-mcp`, `files` (только dist, README, LICENSE, skills, docs), `bin` с shebang,
   `engines`, `repository/homepage/bugs`, `keywords` (mcp, tier-list…), `mcpName` для MCP Registry (`io.github.tiermaker/tiermaker-mcp`),
   `prepublishOnly` = lint+test+build. `server.json` для MCP Registry (не публиковать).
5. **Проверка пакета как у пользователя** (в Docker, node:20 и node:22): `npm pack` → в чистом контейнере `npx -y ./tiermaker-mcp-*.tgz`
   стартует по stdio; скриптовый клиент: list tools → create → add → render_image → get_editor_link. Состав tgz (`npm pack --dry-run`)
   — без тестов, evals, results, секретов; grep на утечки инфраструктуры по tgz.
6. **CI**: `.github/workflows/release.yml` — публикация по тегу через npm trusted publishing (OIDC, `--provenance`), без токенов в репо. Не запускать.
7. Эвалы: 2 полных прогона, строки в отчёт против T-036 (fix2 18/20).
8. CHANGELOG, версия `0.3.0` (тег не ставить). README: установка `npx -y tiermaker-mcp`, конфиги Claude Code/Desktop/Cursor.

## Не делать
- Не публиковать в npm/MCP Registry, не создавать GitHub-репо, не пушить, не логиниться в npm. Прод не трогать.
- Кейсы эвалов не менять.

## Критерии приёмки
- Docker lint/test/build зелёные; `npm audit` без high/critical; tgz ставится и работает через `npx` на node 20 и 22.
- 2 прогона эвалов: 0 искажённых ссылок, остальное не хуже fix2 (кроме pokemon/Commons).
- Отчёт `.team/tasks/T-037-mcp-prerelease.report.md`: список файлов tgz, размер, результаты, что нужно от пользователя для публикации.

## Проверки (тестер)
- Сам собрать tgz, поставить в чистом контейнере, прогнать сценарий; ручной тест в Claude Code с `TIERMAKER_BASE_URL=http://localhost:3000`
  через `claude mcp add` во временном конфиге (не в глобальном пользователя): 2–3 доски, ссылки открываются на dev.

## Прод: нет
