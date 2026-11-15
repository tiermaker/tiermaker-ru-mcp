# T-063 ревью (tester) — коммит 2963ce5 в ../tiermaker-mcp

Вердикт: **PASS** (с двумя неблокирующими уточнениями ledger).

| Критерий | ok? | Доказательство |
| --- | --- | --- |
| Аудит охватывает HEAD и всю историю, указаны метод и ограничения | ok | refs: feat/public-http-oss, main, v0.1.0-local (`git for-each-ref`). Перезапуск `gitleaks git --log-opts=--all --redact` → 37 commits, no leaks. `git grep` по HEAD: IP сервера и инфраструктурные термины только в docs/publication-status.md. `#tm=` с длинным payload в истории — только 203-символьный пример в docs/tierlist-import-v1.md:56 и 20-символьный тестовый. Метод и ограничения (шаблоны, бинарники) записаны в ledger. |
| Блокер e-mail авторов подтверждён | ok | `git log --all --format='%ae\|%ce'`: 35 корпоративный, 2 личный (ровно эти два класса, других нет). |
| Блокер ledger в npm tgz подтверждён | ok | package.json `files` содержит `docs`; `tar -tzf` tgz → package/docs/publication-status.md; IP сервера в нём есть. |
| Кода после 10526f9 нет | ok | `git diff --stat 10526f9 HEAD` → только CHANGELOG.md и docs/publication-status.md. |
| Клиентские прогоны: подтверждены или точная причина блокировки | ok | Статус «not run», причина: подключение коннектора/developer mode = изменение настроек аккаунта, запрещено ТЗ. Без ложных «пройдено». |
| Конкретные дальнейшие действия | ok | Отчёт: решение по истории → очистка ledger → репо+push → прогоны Claude/ChatGPT → Release → сабмиты; overload test открыт. |
| Нет публикации/push/прод-записи | ok | Репо на GitHub не существует (по отчёту и notes); коммит локальный; новый текст ledger не добавляет новых значений инфраструктуры, только их описание. |
| CHANGELOG | ok | Строка в `## Unreleased`. |

## Находки (неблокирующие)
1. docs/publication-status.md (раздел Pre-publication audit): «all 36 commits» и «the tarball matches HEAD» устарели самим коммитом 2963ce5 — теперь 37 коммитов (35 с корпоративным адресом, 2963ce5 тоже), а ledger в tgz = blob 5166ac5 (версия 9c8bb8d), HEAD = aab9858. Воспроизвести: `tar -xzOf artifacts/tiermaker-mcp-0.5.0.tgz package/docs/publication-status.md | git hash-object --stdin` vs `git rev-parse HEAD:docs/publication-status.md`. Исправить формулировку при следующей правке ledger («tarball matches 9c8bb8d; rebuild required»). На решение не влияет: tgz всё равно пересобирать после очистки.
2. Блокер 1 растёт с каждым новым коммитом: до решения владельца (squash или rewrite на noreply) новые коммиты в tiermaker-mcp делать с публичным/noreply адресом или учитывать их при переписывании.

Не проверял: прод-endpoint повторно (read-only наблюдения кодера не перепроверялись), реальные клиенты (блокированы).
