# T-031 отчёт

- Модуль `frontend/lib/tierlist-import.ts` (+ `.md` со схемой, лимитами и примером): валидатор TierListImport v1, encode/decode base64url(deflate) через CompressionStream, лимиты 20/200/32 КБ, только http(s) в imageUrl, дубли id → ошибка, неразмещённые → пул.
- `/create#tm=…`: чтение фрагмента, подтверждение замены несохранённого черновика, `replaceState` убирает фрагмент, без записи на сервер; `templateSlug` — только опубликованный, иначе тост-предупреждение.
- Файл: «Импорт из файла» / «Экспорт в .tierlist.json» (round-trip). Кнопки вынесены в панель «Настройки»: в основном тулбаре они ломали мобильные тесты раскладки (editor-mobile-ux:166, :191).
- В `create/page.tsx` вместо `useToast()` — прямой `toast`: подписка на тосты перерисовывала редактор и ломала «Отменить» после удаления (editor-mobile-ux:295).
- Картинки идут через существующий image-proxy; при сохранении возвращается исходный URL. CSP, backend, зависимости не менялись.
- Проверки: lint (0 ошибок), typecheck, unit 111/111, E2E editor-import 5/5, `make test-predeploy` зелёный (712 backend, 75 E2E). Разово падал auth-shell:162 (флак, при повторе прошёл).
- CHANGELOG, testing-roadmap, новость в blog.ts добавлены.
- Не сделано: (см. «Круг 1»); прод не трогался. `.team/team.env` изменён не мной — не коммитил.

## Круг 1 (по review)
- Находка 1: `create/page.tsx` хранит slug опубликованного шаблона (ref, сбрасывается при обычной загрузке) и передаёт в экспорт. E2E «keeps the published templateSlug…» — round-trip с опубликованным шаблоном (моканый `/api/templates/slug/…`), 6/6 импорт-тестов зелёные; mobile-ux 7/7 отдельно (в общем прогоне 2 теста флакнули под нагрузкой).
- Находка 2 — не исправляется по решению architect: свой S3-хост разрешён CSP и показывается напрямую; строка добавлена в `tierlist-import.md`.
- Находка 3: dev-ссылка (шаблон pizza-styles, headless Chromium в dev-контейнере): 
  http://localhost:3000/create#tm=eJxVjjFqw0AQRa8SftpNYUVuts4NUgYVG3lsFlaW0G4MsRCo9AFSpwikN8YGE4h8ha8bhTWBbLph3v_zpsNGWm_rNfRMIdjgBBoPsrnhZRo48sDTNPCLeygEqRpngjy6lxU0GrvdmjsfXp34SK20Hvqpg11AI66ceRYHDX5w5AUKZe3qFhq3sszzPEevftMmTX9yjO5pxzHtZFk5nwv6QsEGqRKXnaX1dx555vffcZul-I0H7hN4_-_RaeD5qmicKaWSdfDQHaIsagoFcx0zFH3_Aw67dcg
  Результат: тиры «Топ»/«Хорошо», Один/Два на местах, Три в пуле, фрагмент убран из URL, экспорт содержит `"templateSlug": "pizza-styles"`. Проверка скриптовым Chromium, не глазами человека.
