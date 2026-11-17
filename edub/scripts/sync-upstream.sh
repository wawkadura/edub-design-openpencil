#!/usr/bin/env bash
# Edub Design — synchronisation avec l'upstream OpenPencil (ED_1735). Doc : edub/README.md §Upstream.
#
#   bash edub/scripts/sync-upstream.sh [--ref upstream/<branche>] [--quick] [--no-build]
#
# Depuis un clone de DEV (worktree), jamais depuis le clone live. Ne merge JAMAIS dans main :
# crée la branche sync/upstream-<date>, y merge la ref upstream, vérifie, écrit un rapport
# (stdout + docs/edub/sync-reports/<date>.md). Le merge dans main + déploiement restent manuels.
#
#   --ref      ref à merger (défaut : upstream/main). Upstream travaille souvent sur une branche de
#              release vX.Y.Z avant main : le script signale toute branche de release plus récente.
#   --quick    `cargo check` au lieu du build release (rapide, sans wasm).
#   --resume   après résolution d'un conflit et `git commit` du merge : relance vérifications + rapport.
#   --no-build saute Rust + portail (merge + rapport seulement).
# Plafonds : flock /tmp/edub-design-build.lock, CARGO_BUILD_JOBS=4, nice/ionice.
# Codes de sortie : 0 propre · 1 conflit (merge laissé en cours) · 2 vérification KO · 3 usage.
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
REF=upstream/main; QUICK=0; BUILD=1; RESUME=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?}"; shift ;;
    --quick) QUICK=1 ;;
    --no-build) BUILD=0 ;;
    --resume) RESUME=1 ;;
    *) echo "argument inconnu : $1" >&2; exit 3 ;;
  esac
  shift
done
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
export PATH="$HOME/.npm-global/bin:$PATH"
DATE="$(date +%F)"; BRANCH="sync/upstream-$DATE"
log() { printf '\n→ %s\n' "$*"; }
die() { echo "ERREUR : $*" >&2; exit "${2:-3}"; }

[[ "$(id -un)" != edub ]] || die "à lancer depuis un clone de dev, pas le clone live (user edub)"
if [[ $RESUME == 1 ]]; then
  git rev-parse -q --verify HEAD^2 >/dev/null || die "--resume : HEAD n'est pas un commit de merge"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"; BASE_HEAD="$(git rev-parse HEAD^1)"; REF="$(git rev-parse HEAD^2)"
  NEW=$(git rev-list --count "$BASE_HEAD..$REF"); HINT=""
  PATCHED=""
else
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "arbre de travail non propre"
  git remote get-url upstream >/dev/null 2>&1 || die "remote upstream absent"
  
  log "git fetch upstream"
  git fetch upstream --tags --prune || die "fetch upstream KO"
  git rev-parse --verify -q "$REF^{commit}" >/dev/null || die "ref $REF introuvable"
  
  # Release branches ahead of main (upstream merges them late).
  LATEST_REL="$(git for-each-ref --format='%(refname:short)' 'refs/remotes/upstream/v*' | sort -V | tail -1)"
  HINT=""
  if [[ -n "$LATEST_REL" && "$LATEST_REL" != "$REF" ]] && ! git merge-base --is-ancestor "$LATEST_REL" HEAD; then
    N=$(git rev-list --count "$REF..$LATEST_REL" 2>/dev/null || echo ?)
    HINT="Branche de release plus récente : \`$LATEST_REL\` ($N commits devant \`$REF\`). Relancer avec \`--ref $LATEST_REL\` pour la suivre."
  fi
  
  NEW=$(git rev-list --count "HEAD..$REF")
  if [[ "$NEW" == 0 ]]; then
    echo "Rien à intégrer : $REF est déjà dans HEAD."
    [[ -n "$HINT" ]] && echo "$HINT"
    exit 0
  fi
  
  BASE_HEAD="$(git rev-parse HEAD)"
  git checkout -b "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH-$(date +%H%M)" || die "création de branche KO"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  log "merge $REF ($NEW commits) dans $BRANCH"
  
  # Files listed in PATCHES.md (first-column backticked paths) count as "patched".
  PATCHED="$(grep -oE '^\|\s*`[^` ]+`' edub/PATCHES.md | grep -oE '`[^`]+`' | tr -d '`')"
  if ! git merge --no-ff --no-edit "$REF" -m "chore(sync): merge $REF into edub design"; then
    log "CONFLITS"
    CONF="$(git diff --name-only --diff-filter=U)"
    echo "Fichiers Edub (edub/, docs/edub/) :"; echo "$CONF" | grep -E '^(edub|docs/edub)/' | sed 's/^/  /' || true
    echo "Fichiers patchés (edub/PATCHES.md) :"
    while read -r f; do grep -qxF "$f" <<<"$PATCHED" && echo "  $f"; done <<<"$CONF"
    echo "Autres fichiers upstream :"
    while read -r f; do [[ "$f" =~ ^(edub|docs/edub)/ ]] || grep -qxF "$f" <<<"$PATCHED" || echo "  $f"; done <<<"$CONF"
    echo; echo "Merge laissé en cours sur $BRANCH. Résoudre (voir edub/PATCHES.md) puis commit, ou : git merge --abort && git checkout - && git branch -D $BRANCH"
    exit 1
  fi
fi
git submodule update --init --recursive || die "submodules KO" 2

RES=(); FAIL=0
step() { # step <label> <cmd...>
  local label="$1"; shift; log "$label"
  if "$@"; then RES+=("OK   $label"); else RES+=("FAIL $label"); FAIL=1; fi
}
if [[ $BUILD == 1 ]]; then
  export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
  # The shared lock belongs to user edub (deploy build); from a dev user we cannot open it, fall back to a dev lock.
  LOCK=/tmp/edub-design-build.lock
  { : >>"$LOCK"; } 2>/dev/null || { LOCK=/tmp/edub-design-build-dev.lock; echo "(verrou partagé inaccessible → $LOCK)"; }
  CAP=(flock "$LOCK" nice -n 19 ionice -c3)
  if [[ $QUICK == 1 ]]; then
    step "cargo check (op-host-web-server)" "${CAP[@]}" cargo check -p op-host-web-server --locked
  else
    step "cargo build release (op-host-web-server)" "${CAP[@]}" cargo build -p op-host-web-server --features pinned-skia-binaries --release --locked
  fi
  step "cargo test -p op-host-services (online/tenant/hub)" "${CAP[@]}" cargo test -p op-host-services --locked
  step "portail : npm ci" bash -c 'cd edub/portal && npm ci --no-audit --no-fund'
  step "portail : typecheck" bash -c 'cd edub/portal && npm run typecheck'
  step "portail : tests Edub (dont PATCHES.md)" bash -c 'cd edub/portal && npm test'
  step "portail : build Next" bash -c 'cd edub/portal && EDUB_NEXT_DIST_DIR=.next-build npx next build'
  # Smoke : le binaire release démarre et répond (loopback, port éphémère, data jetable).
  if [[ $QUICK == 0 ]] && BIN=target/release/op-host-web-server && [[ -x $BIN ]]; then
    smoke() {
      local d; d="$(mktemp -d)"; local p=$((30000 + RANDOM % 20000)) code=000
      OPENPENCIL_ONLINE_DATA_DIR="$d" "$BIN" --serve-web "$p" --host 127.0.0.1 --online >"$d/out.log" 2>&1 & local pid=$!
      for _ in $(seq 1 15); do sleep 1
        code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/api/health" 2>/dev/null)"
        [[ "$code" != 000 ]] && break
      done
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
      [[ "$code" != 000 ]] || { tail -5 "$d/out.log"; rm -rf "$d"; return 1; }
      echo "serve-web --online répond (HTTP $code)"; rm -rf "$d"
    }
    step "smoke : le binaire démarre" smoke
  fi
fi

# ---- Report ----
OUT="docs/edub/sync-reports/$DATE.md"; mkdir -p "$(dirname "$OUT")"
{
  echo "# Sync upstream $DATE"
  echo; echo "Ref : \`$REF\` ($(git rev-parse --short "$REF")) · branche \`$BRANCH\` · base \`$(git rev-parse --short "$BASE_HEAD")\` · $NEW commits"
  [[ -n "$HINT" ]] && { echo; echo "> $HINT"; }
  echo; echo "## Vérifications"; echo; [[ ${#RES[@]} -gt 0 ]] && printf -- '- %s\n' "${RES[@]}" || echo "- (sautées : --no-build)"
  echo; echo "## Commits intégrés (feat/fix/perf, hors merges)"; echo
  git log --no-merges --pretty='- %h %s' "$BASE_HEAD..$REF" | grep -E '^- \S+ (feat|fix|perf)' | head -80
  echo; echo "## Résumé par type"; echo
  git log --no-merges --pretty='%s' "$BASE_HEAD..$REF" | sed -E 's/^([a-z]+)(\(.*\))?!?:.*/\1/' | sort | uniq -c | sort -rn | sed 's/^/- /'
  echo; echo "## RELEASE_NOTES / CHANGELOG ajoutés"; echo
  git diff --name-status "$BASE_HEAD" HEAD -- 'RELEASE_NOTES/*' 'CHANGELOG*' | sed 's/^/- /'
  for f in $(git diff --name-only --diff-filter=A "$BASE_HEAD" HEAD -- 'RELEASE_NOTES/*'); do echo; echo "### $f"; echo; sed -n '1,60p' "$f"; done
  echo; echo "## Fichiers du cœur sensibles touchés (revoir edub/PATCHES.md)"; echo
  git diff --name-only "$BASE_HEAD" HEAD | grep -Fx -f <(sed -n 's/^| `\(crates\/[^`]*\)`.*/\1/p' edub/PATCHES.md) | sed 's/^/- /' || true
  echo; echo "## Suite (manuelle)"; echo
  echo "1. Relire ce rapport, QA locale. 2. \`git checkout main && git merge --ff-only $BRANCH\` + push. 3. \`sudo -u edub bash /home/edub/apps/edub-design/edub/scripts/deploy.sh\`."
} | tee "$OUT"
git add "$OUT" && git commit -q -m "docs(web): add upstream sync report $DATE" || true
echo; echo "Rapport : $OUT"
[[ $FAIL == 0 ]] || { echo "VÉRIFICATIONS KO — ne pas merger dans main." >&2; exit 2; }
echo "Propre. Branche $BRANCH prête ; main non touché."
