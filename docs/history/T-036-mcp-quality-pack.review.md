# T-036 — tester review

## Verdict: FAIL

Версия проверенного MCP: `9117389`. Код и большая часть требований сделаны, но есть
два воспроизводимых нарушения ТЗ для `search_images`/эвальюатора; кроме того, второй
финальный прогон из отчёта не достигает требуемых 19/20.

| Критерий | Статус | Доказательство |
| --- | --- | --- |
| Docker lint, test, build | ok | `docker run ... node:20-bookworm-slim sh -lc 'npm ci && npm run lint && npm test && npm run build'`: 71 tests, lint и build зелёные. |
| Нет запрещённых локальных/инфраструктурных ссылок | ok | `rg -i -n 'legacy-hosting|/Users/|ssh|\\.team'` по MCP (исключая generated-зависимости) — пусто. |
| `SKILL.md` ≤120 и правила языка, ≤200, пропусков, критерия, одной ссылки, картинок | ok | 73 строки; `skills/tiermaker/SKILL.md:9-10,27-31,34-43,49-60`; инструмент существует в `src/tools.ts:101-106`. |
| `search_images`: Commons, mime, лимит, timeout/UA, ошибки, mock-тесты | нет | Базовая реализация и тесты есть (`src/images.ts:1-119`, `test/images.test.ts`), но реально возвращаемые thumbnail URLs имеют `960px`, а не ≤512. См. finding 1. |
| Подписи и PNG-пример | ok | `test/render.test.ts` проходит; `src/render.ts:78-105`; `.team/tasks/T-036-caption-wrap.png` — валидный PNG 1200×704, визуально текст ограничен тремя строками с многоточием. |
| Evals: не более одной ссылки и честный источник изображений | нет | Повтор одинаковой ссылки засчитывается как одна (`evals/checks.ts:248-250`, тест: `test/evals-checks.test.ts:223-231`); provenance template-картинок не проверяется (finding 2). |
| 2 финальных прогона ≥19/20, оценки не ниже baseline | нет | Отчёт честно фиксирует `final1 19/20`, `final2 18/20`; baseline по трём judge-оценкам выше. |
| Три точечных eval-кейса | ok/нет | Host-only: `notemplate-marvel-en` PASS (9 calls, 40 s, 5/5/5/4); `limit-300-en` PASS (10, 102 s, 4/3/3/4); `images-pokemon-en` FAIL (20, 62 s): image_source 2/27. Полный набор не запускался. Результаты: `/tmp/tm-t036-evals.rR4ShB/evals/results/`. |
| CHANGELOG и 0.2.0 | ok | `package.json:3`, `CHANGELOG.md:3-8`. |

## Отдельная оценка Pokémon и `image_source`: FAIL

Провал Pokémon обоснован как ограничение Wikimedia Commons: живой `search_images`
для `Bulbasaur` вернул 200 `image/jpeg`, но это фото origami; повторенный eval нашёл
лишь 2/27 изображений, причём judge идентифицировал их как origami Bulbasaur и cosplay
Torchic, а не изображения самих персонажей. Это не признак выдуманных URL или сбоя MCP.

Но это не оправдывает изменение проверки. `evals/checks.ts:203-205` выдаёт pass при
любом `templateSlug` и ≥50% `imageUrl`, не сверяя эти URLs ни с успешным
`get_template`/`create_tierlist`, ни с результатом `search_images`. Регрессионный тест
сам создаёт произвольные `https://img.example/...`, устанавливает только
`templateSlug: "cars"` и принимает результат (`test/evals-checks.test.ts:234-246`).
Это ослабление под cars/template-результат и нарушает требование «не выдумывать URL».

## Actionable findings

1. **P1 — `src/images.ts:75,99`; `test/images.test.ts:21-23`: thumbnail не гарантированно ≤512 px.**
   В живых вызовах `Toyota Camry`, `Bulbasaur`, `Eiffel Tower` returned URLs с сегментом
   `960px-...`; все ответили 200 `image/jpeg`. Передача `iiurlwidth=512` не является
   достаточной гарантией от Commons. Нужно возвращать только реально ≤512 thumbnail
   URL (и покрыть это живым/контрактным тестом), иначе описание инструмента и ТЗ неверны.

2. **P1 — `evals/checks.ts:203-205`: template bypass принимает выдуманные URL.**
   Убрать исключение либо доказать provenance каждого принятого URL по успешному ответу
   шаблона; добавленный URL после template должен по-прежнему требовать `search_images`.
   Добавить отрицательный тест: `templateSlug` + arbitrary valid image URLs без поиска → fail.

3. **P2 — `evals/checks.ts:248-250`: «одна ссылка» считается как одна уникальная URL, а не одно вхождение.**
   `SKILL.md:57-58` требует скопировать link один раз и не повторять его. Считать все
   вхождения URL либо явно согласовать менее строгое правило; текущий тест в
   `test/evals-checks.test.ts:226-227` закрепляет противоречие.

## Круг 2 — commit `5e87c31`

### Verdict: FAIL (предыдущие три замечания исправлены)

| Критерий / фикс | Статус | Доказательство |
| --- | --- | --- |
| Docker lint, test, build | ok | Из Docker: `npm ci && npm run lint && npm test && npm run build` — 72 tests passed, lint и build зелёные. |
| P1: URL thumbnail ≤512 px | ok | `src/images.ts:7-8,106-111`: запрос 500, только `thumburl`, проверяются сегмент `/NNNpx-` и `thumbwidth`; `test/images.test.ts:34-40` покрывает 960px, широкий thumbnail и original. Живые Toyota Camry, Bulbasaur, Eiffel Tower: `/500px-…`, 200, `image/jpeg`. |
| P1: provenance шаблонных изображений | ok | `evals/checks.ts:200-222` сверяет каждую URL с данными сайта; `evals/run.ts:58-73` читает тот же raw endpoint/`filePath`, что `Catalog.getTemplate` (`src/catalog.ts:67-94`). Негативные случаи — slug без URL, недоступный шаблон, добавленная URL — в `test/evals-checks.test.ts:248-259`. |
| P2: повтор одной URL | ok | `evals/checks.ts:256-259` считает вхождения, не Set; повтор той же URL теперь fail в `test/evals-checks.test.ts:223-231`. |
| `fix1`: Dota | нет как доказательство полного прогона | Отдельный retry Dota = pass подтверждает, что это не обычный функциональный fail, но не меняет результат полного `fix1` 18/20 и не заменяет два требуемых полных прогона ≥19/20. |
| `fix1`: `exact-12-ru` с fake placeholder + настоящая URL | ok, ловится | Две URL ловятся `checkLinks` (`evals/checks.ts:256-259`), следовательно зафиксированный fail честный. |

Полный eval повторно не запускался. `git diff --check 9117389 5e87c31`, проверка запрещённых ссылок и статус MCP-репозитория — чистые.

### Новая actionable находка

4. **P1 — `evals/checks.ts:51-63,256-259`: одна фейковая ссылка всё ещё может пройти.**
   Сейчас `finalBoard` валидирует URL только из вызова `get_editor_link`, тогда как
   `checkLinks` в тексте ответа проверяет только число URL. Поэтому ответ с *одной*
   фейковой заглушкой вместо настоящего editor URL получил бы `link=pass` (по tool
   call) и `links=pass` (одна URL). Нужны deterministic check и тест: единственная URL
   финального ответа должна в точности равняться `url` последнего успешного
   `get_editor_link` (или отдельная корректная ветка для file fallback).

`SKILL.md:57-58` уже предписывает «full editor link (`url`) copied once from
`get_editor_link`, never shortened … never repeated», поэтому обязательное новое
правило не нужно: проблема — в соблюдении и evaluator. Можно лишь явно усилить эту
формулировку словами «the only URL must equal that tool result», если это повысит
устойчивость агента.

## Круг 3 — commit `972bedb`

### Verdict: FAIL (P1 №4 исправлен, но не хватает регрессионного теста двухходового случая)

| Критерий / фикс | Статус | Доказательство |
| --- | --- | --- |
| Единственная URL ответа сверяется с `url` последнего успешного `get_editor_link` | ok | `tiermaker-mcp/evals/checks.ts:256-267`: `lastIndex(... get_editor_link && ok)` выбирает последний успешный вызов, затем строго сравнивает URL. |
| Одна искажённая/выдуманная ссылка не проходит | ok | `tiermaker-mcp/test/evals-checks.test.ts:223-241`: нормальная ссылка проходит; повтор и единственная заглушка `{"t":"..."}` дают fail. |
| Двухходовой случай защищён unit-тестом | нет | Новый тест создаёт только один успешный `get_editor_link` через `goodCalls()`; пары успешных вызовов с разными URL в `test/evals-checks.test.ts` нет. |
| Docker lint, test, build | ok | `docker run --rm -v "$PWD:/app" -w /app node:20-bookworm-slim sh -lc 'npm ci && npm run lint && npm test && npm run build'`: lint зелёный, 73/73 tests, build зелёный. |
| Артефакт fix2: `edit-en-disney` — реальное искажение, не false positive | ok | `/private/tmp/claude-501/tm-host/evals/results/20261025-180432-fix2/edit-en-disney/result.json`: два успешных `get_editor_link` (turn 0 и turn 1); URL финального ответа имеет 464 символа и отличается от URL turn 1 на индексе 58 (символ №59: `R` вместо `1`). |

- `fix2` подтверждает верную семантику реализации на реальном двухходовом кейсе: сравнение сделано с URL второго (последнего) вызова, а не с URL первого; найденная подмена меняет payload и поэтому делает ссылку на другую/некорректную доску.
- Полный eval не повторялся по заданию. Проверка запрещённых ссылок и `git diff --check 5e87c31 972bedb` чистые.

### Новая actionable находка

5. **P2 — `test/evals-checks.test.ts:223-241`: нет регрессионного теста выбора последнего `get_editor_link` в двухходовой записи.**
   Добавить два успешных `get_editor_link` с различающимися URL: URL последнего должен пройти, URL первого — дать `links=fail`. Текущая реализация выглядит правильной и fix2 это подтверждает, но без такого deterministic-теста будущая замена `lastIndex` на первый вызов вернёт ложные срабатывания в edit-кейсах незамеченной.

## Круг 3 — доп. commit `9fedb89`

### Verdict: PASS

| Критерий | Статус | Доказательство |
| --- | --- | --- |
| Два успешных `get_editor_link`: актуальная ссылка проходит | ok | `tiermaker-mcp/test/evals-checks.test.ts:243-248`: второй вызов содержит URL новой доски, ответ с ним получает `links=pass`. |
| Устаревшая ссылка первого хода отклоняется | ok | `tiermaker-mcp/test/evals-checks.test.ts:249-251`: ответ с URL первого вызова получает `links=fail` с `made up or altered`. Это прямо фиксирует выбор `lastIndex` в `evals/checks.ts:37-40,261-264`. |
| Docker test | ok | `docker run --rm -v "$PWD:/app" -w /app node:20-bookworm-slim sh -lc 'npm ci && npm test'`: 74/74 tests passed. |

Новых actionable-находок в `9fedb89` нет. `git diff --check 972bedb...9fedb89` чист.

## Итоговый вердикт T-036: FAIL по формальным критериям приёмки

Все найденные в ревью дефекты реализации закрыты (thumbnail ≤512, provenance картинок шаблона, все вхождения ссылок, точное сравнение с последним editor link и его двухходовой регресс). Docker-проверки пакета зелёные; последняя точечная проверка — 74/74 tests.

Но критерий двух полных прогонов формально не выполнен: в отчёте `final2` и `fix2` имеют 18/20 вместо ≥19/20, а средние judge-оценки `fix2` по arrangement/completeness ниже baseline. Это не регрессия `9fedb89` и не ложные срабатывания evaluator: `edit-en-disney` зафиксировал реальную подмену одного символа агентом в URL последнего tool result, а `images-pokemon-en` не получил изображения из-за ограниченного покрытия защищённой франшизы в Wikimedia Commons. Для смены этого статуса нужен отдельный согласованный пересмотр источника изображений и/или способа гарантировать дословную передачу агентом длинной ссылки; полный eval в этом круге по заданию не повторялся.
