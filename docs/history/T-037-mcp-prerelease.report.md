# T-037 отчёт: tiermaker-mcp 0.3.0 к выкладке (не опубликовано)

**Коммиты** (tiermaker-mcp, не запушены, тега нет): `8e5a22c` (0.3.0), следующий — убран дублирующий `resource_link` (Claude Code показывал его как второй текст, эвал не мог разобрать результат: прогоны 1–2 дали 2/20 из-за этого, не засчитаны).

**Сделано:** `get_editor_link` → `url`, `markdown` (`[Открыть в редакторе](url)`), `link_file` (`<title>.link.txt` рядом с PNG); SKILL: вставлять `markdown` дословно. zod 4.6.7, SDK 1.32.2, vitest 5.0.5, yaml 2.9.1 — `npm audit`: 0. UA `tiermaker-mcp/0.3.0 (+repo; issues)` из package.json. package.json (mcpName, repository/homepage/bugs, keywords, prepublishOnly, files), `server.json`, `.github/workflows/release.yml` (тег `v*`, OIDC, `--provenance`, без токенов), README (Claude Code/Desktop/Cursor), CHANGELOG.

**Проверки:** Docker node 20 и 22: lint, 76 тестов, build — зелёные. tgz 22.9 КБ, 16 записей: LICENSE, README, CHANGELOG, package.json, server.json, docs/tierlist-import-v1.md, skills/tiermaker/SKILL.md, dist/*.js (9). Без тестов/эвалов/результатов; grep на legacy-hosting, ssh, /Users/, .team, secret, token, gmail — пусто. `npx -y ./tiermaker-mcp-0.3.0.tgz` в чистых контейнерах node 20/22: stdio стартует, 17 инструментов, create→add→place→render→get_editor_link, файл ссылки рядом с PNG — SMOKE PASS.

**Эвалы (против fix2 18/20):** run3 18/20 (судья 4.9/3.9/3.9/4.0, $1.86), run5 18/20 (4.9/3.8/3.6/4.2, $1.83). run4 оборван лимитом сессии, не засчитан.
- **Критерий «0 искажённых ссылок в 2 прогонах» НЕ выполнен:** run3 `notemplate-anime-ru` — агент переписал ссылку (808 симв.) и потерял один `-` в позиции 565, несмотря на `markdown` и дословную инструкцию; run5 — 0 искажений.
- Остальные провалы — Commons/Pokémon (0/27 и 3/27 картинок) и `ambiguous-favorites-en` в run5 (агент не задал вопрос).
- Вывод: пока модель обязана перепечатать длинный URL, остаётся ~1 на 20–40. Надёжное решение — короткая ссылка (серверное хранение гостевых досок, v2) или выдача только файла; решает архитектор.

**Нужно от пользователя для публикации:** создать GitHub-организацию/репо `tiermaker/tiermaker-mcp` и запушить; завести пакет `tiermaker-mcp` на npm и настроить Trusted Publisher (workflow `release.yml`); на проде должен быть фронт с T-031 (иначе ссылки не работают); затем тег `v0.3.0`; публикация в MCP Registry (`server.json`, GitHub-логин) — отдельно.

**Не сделано:** ручной тест в Claude Code с `claude mcp add` — задача тестера. Попутно: eslint 9.27 помечен deprecated (не трогал).
