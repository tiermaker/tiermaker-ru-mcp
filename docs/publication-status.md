# TierMaker.ru MCP — publication status

A public, unofficial MCP for building tier lists and continuing them on
tiermaker.ru. This file tracks what is verified and what is still pending.
Operational and infrastructure details are kept in the maintainers' private
notes, not in this public repository.

## Scope

- One anonymous remote MCP at `https://mcp.tiermaker.ru/mcp`, plus local stdio.
- Create and edit tier-list boards, render PNG, export JSON, and hand off to the
  tiermaker.ru editor via short links. No accounts, no OAuth.
- Boards and files are short-lived (edit retention seven days, files 24 hours);
  256-bit board and file tokens. Per-client-IP rate limits on short links.
- Upstream HTTP does not log request URLs or bodies.

## Status

| Deliverable | Status |
| --- | --- |
| Source and container implementation | Lint, build, 129 tests, plugin package and npm audit pass in dev containers |
| History/materials audit | gitleaks 8.30.1 and personal-data patterns: no secrets; history squashed to a single clean commit |
| Public GitHub repository | Published at `tiermaker/tiermaker-ru-mcp` |
| Remote HTTPS service | Live at `https://mcp.tiermaker.ru/mcp` with valid TLS |
| Claude connector / ChatGPT connector | Not yet exercised in a real conversation |
| Catalog submissions | Not submitted; no portal receipt |

## Acceptance (summary)

Container tests cover board persistence, restart and expiry, rollback,
private-address blocking (SSRF guard), concurrent edits, structured tool
results, rejection of filesystem paths over HTTP, PNG rendering and JSON export.
A real HTTPS client has exercised all tools end to end, including a catalog
fetch, PNG render and a short editor link reopened in a browser. These results
do not substitute for the official catalog install tests, which remain pending.

## Notes

- No CAPTCHA bypass, proxy rotation or browser/TLS impersonation is used.
- Author attribution in LICENSE, README, `package.json` and `plugin.json` is
  intentional and public.
- Private acceptance artifacts (sample PNG/JSON) are gitignored and are not part
  of the npm tarball or plugin package.
