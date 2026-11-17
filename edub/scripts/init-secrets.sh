#!/usr/bin/env bash
# Edub Design — idempotent secret bootstrap (user edub). Creates what is missing,
# never rotates nor prints an existing secret. Called by deploy.sh.
set -euo pipefail
SECRETS="$HOME/.config/edub-design"
PORTAL="$(cd "$(dirname "$0")/../portal" && pwd)"
ENV_FILE="$PORTAL/.env.local"
umask 077
mkdir -p "$SECRETS"
[[ -s "$SECRETS/hub-internal-auth" ]] || openssl rand -hex 32 > "$SECRETS/hub-internal-auth"
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
add() { grep -q "^$1=" "$ENV_FILE" || printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; }
add EDUB_DESIGN_TOKEN_SECRET "$(openssl rand -hex 32)"
add EDUB_DESIGN_HUB_INTERNAL_AUTH_FILE "$SECRETS/hub-internal-auth"
add EDUB_DESIGN_PUBLIC_ORIGIN "https://design.edub.fr"
add EDUB_DESIGN_EDITOR_URL "http://127.0.0.1:3100"
add EDUB_DESIGN_AUTHELIA_URL "http://127.0.0.1:9091"
add EDUB_DESIGN_EDITOR_DATA_DIR "$(cd "$PORTAL/../.." && pwd)/data/editor"
grep -q '^EDUB_DESIGN_DATABASE_URL=' "$ENV_FILE" || { echo "FAIL: EDUB_DESIGN_DATABASE_URL absent de $ENV_FILE" >&2; exit 1; }
mkdir -p "$(cd "$PORTAL/../.." && pwd)/data/editor"
echo "secrets OK"
