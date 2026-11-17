/**
 * First-visit defaults for the OpenPencil web editor, written into ITS localStorage
 * (same origin) before the user follows a link to /editor: French UI, open straight on
 * the canvas instead of Studio Home. Only written when the editor has no settings yet,
 * so a choice made later in the editor is never overwritten. Shape = the editor's own
 * `openpencil-rust-web-settings::<partition>` payload (crates/op-host-web/src/web_settings.rs);
 * an unknown shape is simply ignored by the editor (it falls back to its defaults).
 */
const KEY = "openpencil-rust-web-settings::anon";
const DEFAULTS = {
  version: 1,
  theme: "dark",
  locale: "fr",
  mcp_port: 3100,
  mcp_cli_enabled: Array(13).fill(false),
  images_advanced_open: false,
  auto_update_enabled: false,
  experimental_features_enabled: false,
  image_gen_enabled: false,
  recent_files: [],
  entry_surface: "canvas",
};

const script = `try{if(!localStorage.getItem(${JSON.stringify(KEY)}))localStorage.setItem(${JSON.stringify(
  KEY,
)},${JSON.stringify(JSON.stringify(DEFAULTS))})}catch(e){}`;

export function EditorDefaults() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
