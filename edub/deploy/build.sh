#!/usr/bin/env bash
# Edub Design — build de l'éditeur Rust (user edub). ED_1727.
# Produit dist/op-host-web-server + dist/web-bundle/ (layout attendu par web_static.rs).
# Plafonds : verrou flock global, nice/ionice, CARGO_BUILD_JOBS=4 (Cap E, ED_1549).
set -euo pipefail
cd "$(dirname "$0")/../.."
. "$HOME/.cargo/env"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
TOOLS="$HOME/tools"
export PATH="$TOOLS/wasm-bindgen-cli-0.2.117/bin:$TOOLS/binaryen-version_123/bin:$PATH"
if [[ "${EDUB_DESIGN_BUILD_LOCKED:-}" != 1 ]]; then
  export EDUB_DESIGN_BUILD_LOCKED=1
  exec flock /tmp/edub-design-build.lock nice -n 19 ionice -c3 "$0" "$@"
fi
git submodule update --init --recursive
cargo build -p op-host-web-server --features pinned-skia-binaries --release --locked
bash tools/check-wasm-bundle.sh
rm -rf dist.new && mkdir -p dist.new/web-bundle
cp target/release/op-host-web-server dist.new/
cp -R crates/op-host-web/pkg/. dist.new/web-bundle/
cp -R crates/op-host-web/assets/canvaskit dist.new/web-bundle/canvaskit
for r in assets/prompt_center_previews assets/scene_template_previews assets/scene_templates assets/iconify-catalog-core.json assets/i18n; do
  [[ -e dist.new/web-bundle/$r ]] || { echo "FAIL: bundle sans $r" >&2; exit 1; }
done
rm -rf dist.old; [[ -d dist ]] && mv dist dist.old; mv dist.new dist; rm -rf dist.old
echo "OK dist/ prêt — pm2 restart edub-design-editor"
