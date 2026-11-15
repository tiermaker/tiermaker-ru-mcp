# TierMaker.ru — connector listing draft

Name: TierMaker.ru
One-liner: Create tier lists in a conversation, get a PNG and continue on tiermaker.ru.
Category: Productivity (confirm available category in the portal).

Description: Build a tier list from scratch or a public template, refine the ranking
in conversation, download PNG or JSON and open the result in the TierMaker.ru editor.
No account required. Anonymous boards remain available for seven days after the
last edit. This independent project is not affiliated with tiermaker.com and does
not access saved account work. No interactive in-chat board is included.

Endpoint: https://mcp.tiermaker.ru/mcp (Streamable HTTP, no authentication).
Docs: https://mcp.tiermaker.ru/docs
Privacy: https://mcp.tiermaker.ru/privacy
Support: https://mcp.tiermaker.ru/support
Icon: ../chatgpt/assets/icon.svg (independently authored, square 512px).

Prompts:
- Создай тир-лист напитков: чай в S, кофе в A. Покажи картинку.
- Move coffee into S and give me the updated PNG.
- Find a public fruit template and help me rank its items.

Reviewer: no account or credentials needed. Create a fresh anonymous board, keep
its returned board_id for subsequent calls, and use only sample data. Run every
tool via a Claude custom connector before submission. Use the positive/negative
cases in ../chatgpt/plugin.json and record actual results separately. Owner fills
primary contact and confirms paid-plan access/compliance attestations in the
portal; do not publish credentials in this file. Listing is not submitted.

Portal: https://claude.ai/directory/manage
Requirements: https://claude.com/docs/connectors/building/submission
