# TierMaker.ru MCP privacy

No account, OAuth, or access to saved account work. Board text, image URLs and
placements are stored in SQLite for seven days after the last edit in HTTP mode.
PNG and JSON results expire after 24 hours, and no later than their board. Reads
do not renew retention. A periodic cleanup removes expired records. SQLite may
reuse freed pages; expiration is access revocation, not a promise of forensic
secure erasure. Operator backups must be protected and kept on a documented
retention schedule before production. Stdio boards remain in process memory;
local exports are retained until the user deletes them.

Anyone holding a board token or download link can access the corresponding data.
There is no public board list. Do not send sensitive data. Aggregate metrics
contain tool names, counts and duration, never board IDs, content or access URLs.
Proxy access logs must be disabled for MCP and downloads. Client providers have
their own retention and privacy policies.

Image search sends queries to Wikimedia, Wikidata, PokeAPI, AniList, MusicBrainz,
Cover Art Archive or Open Library as selected by the tool. Rendering fetches the
image URLs and exposes the server IP to those hosts. Search responses are cached
for up to ten minutes. Preserve attribution and check image rights.

Calling get_editor_link sends the board to tiermaker.ru to save a separate editor
draft for 180 days. When unavailable, the returned #tm= URL contains the board;
large boards instead return JSON for manual import. Anyone holding an editor
link can open it. Support: https://github.com/tiermaker/tiermaker-ru-mcp/issues (available
after OSS publication); private security reports use GitHub advisories.
