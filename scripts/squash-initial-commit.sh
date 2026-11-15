#!/usr/bin/env bash
# Squash the whole history into a single clean initial commit authored by the
# public tiermaker account. Prepared for T-147; run only after the owner's
# decisions on history publication (Q18–Q20). This rewrites history — the old
# commits stay reachable via the backup branch created below.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

AUTHOR_NAME="TierMaker"
AUTHOR_EMAIL="347071377+tiermaker@users.noreply.github.com"
BACKUP="archive/pre-squash-$(date +%Y%m%d)"

git branch -f "$BACKUP" HEAD
git checkout --orphan squash-root
git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" \
  commit -m "Initial commit" \
  --author="$AUTHOR_NAME <$AUTHOR_EMAIL>"
git branch -f main squash-root
git checkout main
git branch -D squash-root
echo "Squashed to a single commit on main. Old history kept at $BACKUP."
echo "Publish with: git push -u origin main (after repo is created)."
