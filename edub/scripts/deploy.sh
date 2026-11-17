#!/usr/bin/env bash
# Edub Design — déploiement du clone live (user edub). Doc : edub/README.md §Déployer.
#
#   sudo -u edub bash /home/edub/apps/edub-design/edub/scripts/deploy.sh [--no-pull] [--rust]
#
# 1. git pull --ff-only + submodules            (--no-pull : déploie le HEAD courant)
# 2. build Rust (edub/deploy/build.sh, ~45 min à froid) SEULEMENT si crates/, vendor/,
#    Cargo.*, rust-toolchain.toml ou build.sh ont changé, ou si dist/ manque (--rust : forcé)
# 3. portail : secrets manquants, npm ci si besoin, typecheck, tests, build Next dans le
#    dossier inactif (.next-a / .next-b), migrations drizzle, seed démo idempotent
# 4. swap : .next-active → nouveau dossier, pm2 reload (éditeur redémarré seulement si son
#    binaire ou l'ecosystem ont changé), check /api/health, rollback du portail si KO
# Verrou : /tmp/edub-design-deploy.lock (le build Rust prend en plus /tmp/edub-design-build.lock).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
ECO="$ROOT/edub/deploy/ecosystem.config.cjs"
[[ "$(id -un)" == edub ]] || { echo "À lancer en user edub : sudo -u edub bash $0 $*" >&2; exit 1; }

PULL=1; FORCE_RUST=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --rust) FORCE_RUST=1 ;;
    *) echo "argument inconnu : $arg" >&2; exit 2 ;;
  esac
done

exec 9>/tmp/edub-design-deploy.lock
flock -n 9 || { echo "Un déploiement Edub Design est déjà en cours." >&2; exit 1; }
export PATH="$HOME/.npm-global/bin:$PATH"
log() { printf '\n→ %s\n' "$*"; }

BEFORE="$(git rev-parse HEAD)"
if [[ $PULL == 1 ]]; then
  log "git pull --ff-only"
  git pull --ff-only
  git submodule update --init --recursive
fi
AFTER="$(git rev-parse HEAD)"
changed() { [[ "$BEFORE" != "$AFTER" ]] && git diff --name-only "$BEFORE" "$AFTER" | grep -Eq "$1"; }

RESTART_EDITOR=0
if [[ $FORCE_RUST == 1 || ! -x dist/op-host-web-server ]] \
  || changed '^(crates/|vendor/|Cargo\.(toml|lock)$|rust-toolchain\.toml$|edub/deploy/build\.sh$)'; then
  log "build Rust (long, sous plafonds)"
  bash edub/deploy/build.sh
  RESTART_EDITOR=1
fi
# Editor restarted when the ecosystem differs from the one last applied (stamp, gitignored).
ECO_STAMP="$ROOT/edub/deploy/.ecosystem-applied"
ECO_SHA="$(sha256sum "$ECO" | cut -d' ' -f1)"
[[ "$(cat "$ECO_STAMP" 2>/dev/null || true)" == "$ECO_SHA" ]] || RESTART_EDITOR=1

log "portail"
cd "$ROOT/edub/portal"
bash ../scripts/init-secrets.sh
if [[ ! -d node_modules ]] || changed '^edub/portal/package(-lock)?\.json$'; then
  npm ci --no-audit --no-fund
fi
npm run --silent typecheck
npm test --silent >/dev/null
ACTIVE="$(cat .next-active 2>/dev/null || true)"
NEXT=.next-a; [[ "$ACTIVE" == .next-a ]] && NEXT=.next-b
rm -rf "$NEXT"
EDUB_NEXT_DIST_DIR="$NEXT" nice -n 10 npx next build >/tmp/edub-design-portal-build.log 2>&1 \
  || { tail -40 /tmp/edub-design-portal-build.log; exit 1; }
npm run --silent db:migrate
npm run --silent seed:demo

log "swap $ACTIVE → $NEXT + pm2 reload"
echo "$NEXT" > .next-active
cd "$ROOT"
if [[ $RESTART_EDITOR == 1 ]]; then
  pm2 delete edub-design-editor >/dev/null 2>&1 || true
  pm2 start "$ECO" --only edub-design-editor
  echo "$ECO_SHA" > "$ECO_STAMP"
fi
pm2 startOrReload "$ECO" --only edub-design-portal --update-env

log "check santé"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3038/api/health 2>/dev/null | grep -q '"ok":true'; then
    pm2 save >/dev/null
    echo "OK déployé $(git rev-parse --short HEAD) (portail $NEXT)"
    exit 0
  fi
  sleep 2
done
echo "ÉCHEC : /api/health KO après 60 s" >&2
curl -sS http://127.0.0.1:3038/api/health >&2 || true
if [[ -n "$ACTIVE" ]]; then
  echo "rollback du portail vers $ACTIVE" >&2
  echo "$ACTIVE" > edub/portal/.next-active
  pm2 startOrReload "$ECO" --only edub-design-portal --update-env
fi
exit 1
