#!/usr/bin/env bash
# Import of tamafit-app/docs/designs into the Edub Design project `tamafit` (ED_1733).
#
# The TamaFit repo is not readable by the `edub` user, so this runs as a user who can read it (ubuntu):
#   1. READ-ONLY snapshot of docs/designs (+ the repo's assets/, which some mockups reference) into a
#      temp dir, plus the last git commit date of every file (never writes in the source repo);
#   2. the actual import, as `edub` (owns the DB and data/), from that snapshot;
#   3. the snapshot is deleted. TamaFit designs never enter the (public) fork.
#
# Usage:  bash edub/scripts/import-tamafit-designs.sh [--dry-run] [--report /tmp/report.md]
# Re-run as often as needed: idempotent (key = source path), see edub/portal/scripts/import-tamafit-designs.ts.
set -euo pipefail

REPO="${TAMAFIT_REPO:-/home/tamagofit/apps/tamafit-app}"
LIVE="${EDUB_DESIGN_LIVE:-/home/edub/apps/edub-design}"
IMPORT_AS="${IMPORT_AS:-edub}"   # user owning the DB / data dir ("" = current user, for dev)
STAGE="$(mktemp -d /tmp/tamafit-designs-stage.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/docs"
rsync -a "$REPO/docs/designs/" "$STAGE/docs/designs/"
[ -d "$REPO/assets" ] && rsync -a "$REPO/assets/" "$STAGE/assets/"
# last commit date per file, relative to docs/designs (read-only git; the repo belongs to another user)
git -c safe.directory='*' -C "$REPO" log --format='@@%cI' --name-only -- docs/designs | node -e '
  const out = {}; let when = null;
  for (const line of require("fs").readFileSync(0, "utf8").split("\n")) {
    if (line.startsWith("@@")) when = line.slice(2);
    else if (line.startsWith("docs/designs/") && when && !(line.slice(13) in out)) out[line.slice(13)] = when;
  }
  require("fs").writeFileSync(process.argv[1], JSON.stringify(out));' "$STAGE/dates.json"
chmod -R a+rX "$STAGE"

run=(npx tsx scripts/import-tamafit-designs.ts --source "$STAGE/docs/designs" --repo-root "$STAGE" --dates "$STAGE/dates.json" "$@")
cd "$LIVE/edub/portal"
if [ -n "$IMPORT_AS" ] && [ "$(id -un)" != "$IMPORT_AS" ]; then sudo -u "$IMPORT_AS" "${run[@]}"; else "${run[@]}"; fi
