import { eq } from "drizzle-orm";
import { accessForTenant } from "@/lib/access.ts";
import { handle, json, notFound } from "@/lib/api.ts";
import { getDb, schema } from "@/lib/db/index.ts";
import { TENANT_RE } from "@/lib/editor-token.ts";
import { isAdmin } from "@/lib/identity.ts";
import { canWrite } from "@/lib/rights.ts";

export const dynamic = "force-dynamic";

/**
 * Context of the open editor tab (ED_1730): who I am on this file, where it lives, so the
 * editor overlay (public/edub-shell.js) can draw "← Bibliothèque", the breadcrumb and the
 * read-only banner. No access = 404, same as the editor page itself.
 */
export const GET = (req: Request) =>
  handle(req, async (me) => {
    const tenant = new URL(req.url).searchParams.get("tenant") ?? "";
    if (!TENANT_RE.test(tenant)) return notFound();
    const access = await accessForTenant(me, tenant);
    if (!access) return notFound();
    const { file, project, role } = access;

    // Folder chain, root first (depth-capped: a cycle would otherwise loop).
    const folders: { id: string; name: string }[] = [];
    let folderId = file.folderId;
    for (let i = 0; folderId && i < 16; i++) {
      const [f] = await getDb().select().from(schema.folders).where(eq(schema.folders.id, folderId)).limit(1);
      if (!f) break;
      folders.unshift({ id: f.id, name: f.name });
      folderId = f.parentId;
    }

    return json({
      ok: true,
      role,
      canWrite: canWrite(role),
      // Built-in AI: Walid (Authelia admin) only; the gate enforces it, this only hides the UI.
      ai: isAdmin(me),
      user: me.username,
      project: { slug: project.slug, name: project.name, emoji: project.emoji },
      folders,
      file: { id: file.id, name: file.name },
      links: {
        library: `/p/${project.slug}`,
        home: "/",
      },
    });
  });
