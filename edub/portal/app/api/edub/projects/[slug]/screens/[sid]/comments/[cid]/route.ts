import { json } from "@/lib/api.ts";
import { canManage } from "@/lib/rights.ts";
import { deleteComment } from "@/lib/screens.ts";
import { withScreen } from "@/lib/screens-route.ts";

export const dynamic = "force-dynamic";

export const DELETE = (req: Request, { params }: { params: Promise<{ slug: string; sid: string; cid: string }> }) =>
  withScreen(req, params, {}, async (me, { role }, s) => {
    await deleteComment(me, canManage(role), s, (await params).cid);
    return json({ ok: true });
  });
