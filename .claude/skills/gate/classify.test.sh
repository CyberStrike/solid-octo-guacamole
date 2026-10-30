#!/usr/bin/env bash
# Table-driven check of classify.sh: each case is a changed-file list and the protocols it must print.
# Not part of CI.
#
#   bash .claude/skills/gate/classify.test.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
fail=0

check() {
  local want="$1" got
  shift
  got="$(printf '%s\n' "$@" | bash "$here/classify.sh" --stdin 2>/dev/null | tr '\n' ' ')"
  if [ "$got" = "$want " ]; then
    echo "ok   [$want] <- $*"
  else
    echo "FAIL [$want] <- $* (got [$got])"
    fail=1
  fi
}

check "docs" docs/ARCHITECTURE.md
check "docs" README.md .claude/skills/gate/SKILL.md
check "docs" .github/pull_request_template.md
check "docs" .github/ISSUE_TEMPLATE/bug.yml
check "integration" .github/workflows/ci.yml
check "integration docs" .github/workflows/ci.yml .github/pull_request_template.md
check "integration" .claude/skills/gate/classify.sh
check "integration" .claude/settings.json
check "integration" .claude/hooks/pre-tool.js
check "integration" .claude/skills/gate/lib/deep/helper.sh
check "docs" specs/scenarios/mvp/01-auth-magic-link.md
check "integration" spikes/better-auth/src/worker.ts
check "integration" packages/epub/package-lock.json
check "integration" scripts/a.sh
check "integration" package.json
check "web integration" apps/web/wrangler.jsonc apps/web/src/a.ts
check "integration" packages/epub/package.json
check "epub ingest" packages/epub/src/sanitize.ts
check "epub ingest" fixtures/epubs/one-shot.epub
check "db" packages/db/migrations/0001_init.sql
check "ingest" apps/ingest/src/a.ts
check "web" apps/web/src/a.ts
check "content" apps/content/src/a.ts
check "mailer" apps/mailer/src/a.ts
check "mailer integration" apps/mailer/wrangler.jsonc apps/mailer/src/a.ts
check "epub ingest web docs" packages/epub/src/a.ts apps/web/src/a.ts docs/ARCHITECTURE.md

exit "$fail"
