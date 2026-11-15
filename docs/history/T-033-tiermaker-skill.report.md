# T-033 report (coder)
Коммиты в tiermaker-mcp: da16e3e (fix by-slug → /api/templates/slug/), 5afd5af (skills/tiermaker/SKILL.md 60 строк, README «Skill», CHANGELOG, `skills` в package.json files).
Проверки: Docker node:22 — lint, test (46), build зелёные; grep на инфраструктуру/пути пуст.
Прогоны: `claude -p` + `--mcp-config` (TIERMAKER_BASE_URL=http://localhost:3000), скилл в временном `.claude/skills` (глобально не ставил). MCP на хосте запускал из копии в scratchpad (в репо node_modules линуксовые, resvg-darwin нет).
1. "tier list of Marvel movies": search_templates → create_tierlist → add_items(37) → place_items → get_tierlist → render_image → get_editor_link. Шаблона нет, доска с нуля; PNG есть; ссылка в dev-редакторе: 5 тиров S–D, 37 элементов.
2. "тир-лист языков…, тиры: учить/можно/не надо": search×2 (en/ru) → create_tierlist(3 тира с цветами) → add_items(24) → place → get_tierlist → render → link. Редактор: 3 тира, 24 элемента, PNG есть.
3. "из шаблона pizza-styles": create_tierlist(template_slug) → get_tierlist → place → render → link. Редактор: 12 элементов в S–D, PNG есть.
Найдено: (а) баг MCP — get_template/template_slug брали /api/templates/by-slug/ (на сайте 404, верный /api/templates/slug/); первый прогон r3 упал на нём, исправлено (da16e3e), прогон повторён успешно. (б) Первый прогон не стартовал: native resvg для darwin отсутствовал — окружение, не код.
Не исправлено, список: длинные подписи обрезаются на карточках PNG (Thunderbolts*, Multiverse of Madness); агент один раз вызвал add_items с пустым массивом (схема отвергла, сам исправился); без явного «never skip» агент пропускал get_tierlist — усилил в скилле; в шаблоне pizza-styles картинки не соответствуют названиям (данные dev).
Скилл в Claude Code срабатывает сам (вызывает Skill tiermaker); MCP-инструменты агент подгружал через ToolSearch.
