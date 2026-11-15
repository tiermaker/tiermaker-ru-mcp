# T-063 разведка публикации tiermaker-mcp (read-only, 2026-11-10)

- Ledger: tiermaker-mcp/docs/publication-status.md. Ветка feat/public-http-oss @9c8bb8d, рабочее дерево чистое; в main не слито, push не было.
- GitHub: SSH-алиас `<oss-ssh-alias>` аутентифицирует как <personal-gh-account>, но `git ls-remote origin` → "Repository not found". API: <personal-gh-account> public_repos=0, github.com/<personal-gh-account>/tiermaker-mcp → 404. Репозиторий не создан. `gh` CLI на хосте отсутствует; дефолтный `git@github.com` — Permission denied (битый путь к ключу в ssh config).
- Значит для создания репо нужен браузерный логин <personal-gh-account> (или установка/логин gh) — действие владельца; затем push ветки/main.
- Endpoint mcp.tiermaker.ru жив: healthz/docs/privacy/support/terms 200, /metrics 404, `initialize` по /mcp → TierMaker.ru 0.5.0, tools.listChanged.
- Готовые материалы: artifacts/tiermaker-ru-plugin.zip, tiermaker-mcp-0.5.0.tgz, distribution/chatgpt (plugin.json, mcp.json, assets), docs/release-0.5.0-draft.md (не опубликован).
- Осталось по ledger (порядок): 1) создать публичный репо + push; 2) реальный Claude custom connector — прогон всех 17 tools в настоящем чате; 3) реальный ChatGPT connection — создание/правка/PNG/download/импорт в редактор + запись walkthrough-видео (нужно OpenAI); 4) GitHub Release v0.5.0 (только после п.2–3); 5) владелец: платный план Claude/регион, OpenAI publisher/domain verification; 6) сабмиты Claude (claude.com/docs/connectors/building/submission) и OpenAI (developers.openai.com/plugins/deploy/submission), правки модерации, публикация, тест установки.
- Также не закрыто: полный sustained overload test.
- Риски: публикация ветки с историей (36 коммитов; аудит секретов был по 29 коммитам/161 blob — после аудита добавлялись коммиты, стоит перепрогнать скан); не класть в релиз пути оператора/токены досок; walkthrough URL нельзя придумывать.
- Ничего не публиковал, не менял.
