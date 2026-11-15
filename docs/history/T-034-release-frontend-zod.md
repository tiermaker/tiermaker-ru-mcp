# T-034: выпуск frontend без MCP-изменений (удаление zod, T-029)

**Прод: разрешён** — пользователь 2026-10-24: «всё, что не связано с MCP, можешь задеплоить».
Объём: frontend ровно на коммите `3936fc1` (содержит T-029, не содержит T-031 импорт по ссылке).
Между прод-frontend и `3936fc1` отличаются только `frontend/package.json` и `frontend/pnpm-lock.yaml` — проверить.
Backend не деплоить (после `3936fc1` backend не менялся, он уже на проде). Без новости в blog.ts и Telegram (видимых изменений нет).
НЕ разрешено: деплой HEAD/T-031, правки `.env`, записи в БД, миграции, push/merge.

## Контекст
- `.team/tasks/T-029-remove-unused-zod.*`, образец выпуска `.team/tasks/T-028-release-put-owner-analytics.{md,report.md}`, `docs/DEPLOYMENT.md`.
- Curl/postdeploy без прокси Mac (`env -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY -u all_proxy -u ALL_PROXY`), ключ `CHECK_REQUEST_KEY_FILE=~/.config/tiermaker/check_key`.

## Что сделать
1. Отдельный git worktree на `3936fc1` в scratch-папке вне репо (основное дерево не трогать). Деплой — из него.
2. Read-only: текущий frontend-коммит на проде = rollback-точка; команда отката в отчёт до деплоя. Проверить, что diff прод-frontend..3936fc1 по `frontend/` = только package.json + lockfile; иначе STOP → question.
3. Gate на `3936fc1`: frontend lint/typecheck/unit, `pnpm audit --prod` без high/critical, E2E Chromium, `pnpm build:standalone`.
4. Деплой frontend по `docs/DEPLOYMENT.md`.
5. `make test-postdeploy BASE_URL=https://tiermaker.ru` с ключом — зелёный.
6. Провал → откат frontend, STATUS: fail.
7. 15 мин: 5xx не выше фона, главная/каталог/редактор открываются.
8. Удалить worktree и временные `/tmp/tiermaker-frontend-*`.
9. Отчёт `docs/deployment-report-2026-10-24-frontend-zod.md` + `.team/tasks/T-034-release-frontend-zod.report.md` (без секретов и IP); коммит в основное дерево.

## Критерии приёмки
- На проде frontend = `3936fc1`, postdeploy зелёный, 5xx на фоне; worktree и временные файлы удалены.

## Прод: разрешён (в объёме выше)
