#!/usr/bin/env bash
# Prints the gate protocols a branch's diff needs, one per line, in the order SKILL.md §4 runs
# them. Compares the commits since the merge base with a base (default origin/main), plus
# uncommitted changes to tracked files; untracked files are ignored, since scratch files sit
# untracked in the checkout while they run.
#
#   bash .claude/skills/gate/classify.sh [base]
#   bash .claude/skills/gate/classify.sh --stdin < changed-files.txt   (what classify.test.sh drives)
#
# From the PowerShell tool on Windows, bash may resolve to WSL, which cannot read a Git Bash
# checkout. Call Git Bash by path: & "C:\Program Files\Git\bin\bash.exe" <this script>
set -u
if [ "${1:-}" = "--stdin" ]; then
  files="$(sort -u)"
else
  cd "$(git rev-parse --show-toplevel)" || exit 2
  base="${1:-origin/main}"
  mb="$(git merge-base "$base" HEAD)" || { echo "no merge base with $base; fetch it first" >&2; exit 2; }
  # --no-renames so a moved file counts against the workspace it left as well as the one it joined.
  files="$(git -c core.quotePath=false diff --name-only --no-renames "$mb" | sort -u)"
fi
[ -n "$files" ] || { echo "no changes${base:+ against $base}" >&2; exit 1; }

declare -A need=()
while IFS= read -r f; do
  # The parser feeds ingest, and ingest's output is what web renders, so an epub change also
  # runs ingest's checks. A schema change reaches every Worker through typecheck. An unknown
  # path runs everything.
  case "$f" in
    # Bindings, limits and dependencies change how every Worker runs, wherever the file sits.
    */wrangler.jsonc | */wrangler.toml | */package.json | package-lock.json | */package-lock.json) need[integration]=1 ;;
    packages/epub/* | fixtures/*) need[epub]=1; need[ingest]=1 ;;
    packages/db/*) need[db]=1 ;;
    apps/ingest/*) need[ingest]=1 ;;
    apps/web/*) need[web]=1 ;;
    apps/content/*) need[content]=1 ;;
    # No Worker and no CI job reads Markdown or issue templates under .github.
    .github/*.md | .github/ISSUE_TEMPLATE/*) need[docs]=1 ;;
    .github/* | scripts/*) need[integration]=1 ;;
    # Markdown under .claude/ (skills, agents) is docs. Anything else there (scripts, hooks,
    # settings) is executable process. In a case pattern `*` also matches `/`, so this covers
    # every depth.
    .claude/*.md) need[docs]=1 ;;
    .claude/*) need[integration]=1 ;;
    docs/* | *.md) need[docs]=1 ;;
    *) need[integration]=1 ;;
  esac
done <<< "$files"

# docs is printed whenever docs changed, even beside other protocols, so the Decisions-table
# check still runs on a mixed code and design change. SKILL.md skips the standing checks only
# when docs is the sole protocol.

echo "changed: $(echo "$files" | cut -d/ -f1-2 | sort -u | tr '\n' ' ')" >&2
for p in epub db ingest web content integration docs; do
  [ -n "${need[$p]:-}" ] && echo "$p"
done
exit 0
