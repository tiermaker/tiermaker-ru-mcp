# TierMaker.ru MCP 0.5.0 — release draft

Not published. Release gate: remote HTTPS and both real-client acceptance runs.

Create tier lists with TierMaker.ru through local stdio or anonymous remote MCP.
Edit rankings across messages, render PNG and download importable JSON. Continue
on tiermaker.ru using editor links. Remote boards survive restarts for seven days
after the last change; exported files use independent temporary links. No account
access, OAuth or interactive in-chat board in this release.

Run from a GitHub source checkout: npm ci, npm run build, node dist/index.js.
Remote operator: build the Dockerfile, mount persistent /data and run dist/http.js
behind the reviewed independent CLO HTTPS route. See README and privacy policy.
The release archive is built by the manual workflow; there is no automatic npm
publication. Attach the tested plugin ZIP only after filling the real walkthrough
and verifying publisher/domain settings. Publish GitHub tag/release v0.5.0 only
when the acceptance ledger has real-client evidence.

## Site news draft (before production release)

Proposed slug: tier-lists-in-your-chat
Title: Тир-листы из диалога

Теперь тир-лист можно собрать в разговоре с помощником: выбрать тему, обсудить
расстановку и получить картинку. Продолжить работу с результатом можно в
редакторе TierMaker.ru по готовой ссылке.

This is draft copy, not an announcement of a completed launch. Add it to
frontend/lib/blog.ts only as part of the separately verified site release;
confirm final client availability before publishing the news text.
