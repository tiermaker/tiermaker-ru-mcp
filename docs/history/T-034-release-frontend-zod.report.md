# T-034 — отчёт кодера

- Frontend на проде = `3936fc1`. Diff `74ac0ba..3936fc1` по `frontend/` — только package.json + lockfile (прод-frontend выложен 2026-10-23 из этой линии).
- Gate в отдельном worktree/amd64-контейнере: unit 102, typecheck, lint, audit (в т.ч. --prod) чисто, Chromium 75/75, build:standalone + проверка артефакта.
- Деплой `deploy-frontend-legacy-hosting.sh`; rollback: `standalone_prev_20261024_215609` (команда в `docs/deployment-report-2026-10-24-frontend-zod.md`).
- Postdeploy с ключом, без прокси: 33/33.
- 15 мин: 5xx 0/429 против 0/864 на фоне; главная, каталог, /create — 200.
- Откат не понадобился. Worktree, контейнер/тома, /tmp env и артефакты удалены.
- Попутно: MCP-инструмент prod-db-readonly зависал; агрегаты сняты через Django shell (read-only).
