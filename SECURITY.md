# Security and privacy

TierMaker.ru is independent of tiermaker.com. See [privacy](docs/privacy.md).

Stdio keeps boards in memory and writes user-requested local exports. HTTP uses
SQLite and high entropy board tokens, which grant access to that board. There is
no board listing, login, OAuth, or access to account work. HTTPS download tokens
are independent and expire after 24 hours or when the board expires. Boards
expire seven days after the last edit. Reads do not renew retention.

Outbound traffic includes the site catalog, image searches (including POST to
AniList), image hosts, and optional POST of the board to the site's draft API.
Editor drafts have a separate 180-day retention; full fallback URLs contain the
board. The anonymous draft API's existing limits remain in force.

HTTP network connections reject non-public IPs at socket DNS resolution, literal
IPs, redirects to private addresses, credentials, and nonstandard ports. HTTP
never accepts output_path. Bodies, source caches, downloads, render queues, and
request rates are bounded. Overload does not mutate a board. Run one replica.
Use a firewall and TLS gateway; do not expose its loopback upstream port publicly.
Do not enable access logs containing URLs or request bodies on the gateway.

Report vulnerabilities through a private GitHub security advisory at
https://github.com/tiermaker/tiermaker-ru-mcp/security/advisories/new . Do not send tokens
or personal board content in public issues. Public submission and advisories
require the repository to have been published; see the publication status file.
