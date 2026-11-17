#!/usr/bin/env bash
# Edub Design — rappel mensuel (ED_1735) : ouvre un ticket « Mettre à jour Edub Design depuis l'upstream »
# sur le board Edub Dev. Le board n'expose pas de ticket récurrent aux agents : on utilise cron.
#   17 6 1 * * bash /home/ubuntu/apps/edub-design/edub/scripts/upstream-reminder.sh >> /tmp/edub-design-reminder.log 2>&1
# Clé API : lue à l'exécution dans la config MCP du user (jamais copiée dans le dépôt) ou $EDUB_API_KEY.
set -euo pipefail
REPO="${EDUB_DESIGN_REPO:-/home/ubuntu/apps/edub-design}"
API="${EDUB_API_URL:-http://127.0.0.1:3010}"
KEY="${EDUB_API_KEY:-$(jq -r '.mcpServers.edub.env.EDUB_API_KEY // empty' "$HOME/.claude.json")}"
[[ -n "$KEY" ]] || { echo "pas de clé API Edub" >&2; exit 1; }

NEWS="(fetch impossible)"; REL=""
if git -C "$REPO" fetch upstream --tags --prune -q 2>/dev/null; then
  N=$(git -C "$REPO" rev-list --count HEAD..upstream/main 2>/dev/null || echo "?")
  REL=$(git -C "$REPO" for-each-ref --format='%(refname:short)' 'refs/remotes/upstream/v*' | sort -V | tail -1)
  NEWS="$N commit(s) sur upstream/main ; dernière branche de release : ${REL:-?}"
fi
NAME="Mettre à jour Edub Design depuis l'upstream ($(date +%Y-%m))"
DESC=$(printf '%s\n' "Rappel mensuel automatique (cron, edub/scripts/upstream-reminder.sh)." "" "État de l'upstream : $NEWS." "" "## À faire" "1. Depuis une worktree : \`bash edub/scripts/sync-upstream.sh\` (ajouter \`--ref upstream/<release>\` si une branche de release est devant main)." "2. Lire le rapport (\`docs/edub/sync-reports/\`), tenir \`edub/PATCHES.md\` à jour." "3. Si propre : ff-merge dans \`main\` + \`deploy.sh\`." "4. Fin en QA avec le rapport en récap.")
BODY=$(jq -n --arg n "$NAME" --arg d "$DESC" '{name:$n,description:$d,project:"edub-design",priority:"C - Could Do",planning:"current",assignee:{kind:"project",ref:"/home/ubuntu/apps/edub-design",label:"edub-design"}}')
curl -fsS -X POST "$API/api/todo/" -H "x-api-key: $KEY" -H 'content-type: application/json' -d "$BODY" | jq -r '.data.id // .id // .'
