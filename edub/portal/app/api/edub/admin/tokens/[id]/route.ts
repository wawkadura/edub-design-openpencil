import { handle, json } from "@/lib/api.ts";
import { isAdmin } from "@/lib/identity.ts";
import { revokeToken } from "@/lib/mcp/admin.ts";
import { HttpError } from "@/lib/projects.ts";

export const dynamic = "force-dynamic";

/** Revoke (immediate: the next call with this token gets 401). */
export const DELETE = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(req, async (me) => {
    if (!isAdmin(me)) throw new HttpError(404, "not_found");
    await revokeToken((await params).id);
    return json({ ok: true });
  });
