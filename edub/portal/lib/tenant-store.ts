import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

/** New editor tenant id for a design file: `f_` + 32 hex chars. */
export function newTenantId(): string {
  return `f_${randomBytes(16).toString("hex")}`;
}

/**
 * Where the Rust editor keeps a tenant's document: `<dataDir>/<sha256(id)[..16]>/current.op`
 * (crates/op-host-services/src/web_canvas_server/tenant_store.rs). Only write it while the
 * tenant is NOT resident in the editor (new file), or the editor's next flush overwrites it.
 */
export function tenantDocumentPath(dataDir: string, tenantId: string): string {
  const dir = createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
  return path.join(dataDir, dir, "current.op");
}
