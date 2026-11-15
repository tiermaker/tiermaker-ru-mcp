# T-063 отчёт (coder)

Сделано (всё read-only, кроме коммита документации в ../tiermaker-mcp 2963ce5 — ledger + CHANGELOG; без push):
- Аудит истории: все refs (feat/public-http-oss, main, v0.1.0-local), 36 коммитов, 216 blob + рабочее дерево. gitleaks 8.30.1 (git --all, dir, redact) — 0 утечек; скан шаблонов по каждому blob и сообщениям коммитов (e-mail, home-пути, IPv4, инфраструктура, присваивания секретов, ссылки досок, имя/телефон) — только счётчики. Ограничение: шаблоны, бинарники/новые форматы могут пропуститься.
- Секретов, home-путей и реальных ссылок досок нет (#tm в docs — пример из 1 элемента; IP — тестовые для SSRF).
- БЛОКЕР 1: author/committer всех 36 коммитов — непубличные e-mail (34 — корпоративный рабочий, 2 — личный gmail). Нужно решение владельца: один чистый squash-коммит (как OSS сайта) или переписать историю на GitHub noreply. Текущую историю не пушить.
- БЛОКЕР 2: docs/publication-status.md трекается и входит в npm tgz; содержит провайдеров, IP сервера, порты/подсеть, маршрут, имя бэкапа. Очистить/вынести до публичного репо и пересборки tgz.
- Артефакты: tgz = HEAD (до моего коммита; ledger изменился → пересобрать после очистки), ZIP = distribution+skill. В artifacts/ лежат приватные acceptance PNG/JSON (gitignored) — в релиз не прикладывать. Кода после протестированного 10526f9 нет, тесты не перезапускал.
- Endpoint (read-only): docs/privacy/support/terms 200, metrics 404, initialize → TierMaker.ru 0.5.0, tools/list 17, LE до 2027-02-08. Один /healthz timeout 15 с, затем 8/8 по <0.25 с.
- GitHub: <personal-gh-account> public_repos=0, репо 404, ssh «Repository not found», gh нет.
- Клиентские прогоны Claude/ChatGPT: НЕ выполнены. Причина: добавление custom connector / developer mode = изменение настроек аккаунта под сессией владельца, ТЗ это запрещает. Статус «not run».
Дальше (владелец): решить по истории/e-mail → очистить ledger → создать <personal-gh-account>/tiermaker-mcp и push → подключить коннектор в Claude и ChatGPT и прогнать 17 tools + walkthrough-видео → Release v0.5.0 → сабмиты. Sustained overload test всё ещё не сделан.
