import { bodyOf, handle, json } from "@/lib/api.ts";
import { isAdmin } from "@/lib/identity.ts";
import { createToken, listTokens } from "@/lib/mcp/admin.ts";
import { HttpError } from "@/lib/projects.ts";

export const dynamic = "force-dynamic";

/** Agent MCP tokens (Authelia admin only; 404 for everyone else). */
export const GET = (req: Request) =>
  handle(req, async (me) => {
    if (!isAdmin(me)) throw new HttpError(404, "not_found");
    return json({ ok: true, tokens: await listTokens() });
  });

/** `{ label, scopes: [{project: slug|"*", role: "viewer"|"editor"}] }` → the secret, shown once. */
export const POST = (req: Request) =>
  handle(req, async (me) => {
    if (!isAdmin(me)) throw new HttpError(404, "not_found");
    const body = await bodyOf(req);
    const { token, secret } = await createToken(me.username, body.label, body.scopes);
    return json({ ok: true, token, secret }, 201);
  });
