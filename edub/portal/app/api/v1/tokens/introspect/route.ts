import { verifyEditorToken, secretEquals } from "@/lib/editor-token.ts";
import { env, hubInternalAuth } from "@/lib/env.ts";

/**
 * op-hub token introspection contract, called by the Rust editor
 * (`crates/op-host-services/src/hub_auth_client.rs`, header X-OP-Internal-Auth).
 * The answer's `user_id` is the editor TENANT (a design file), `username` the human.
 * Loopback only: nginx refuses `/api/v1/` from outside.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const presented = req.headers.get("x-op-internal-auth") ?? "";
  if (!secretEquals(presented, hubInternalAuth())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let token = "";
  try {
    const body = (await req.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : "";
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }
  const claims = verifyEditorToken(env.tokenSecret, token);
  if (!claims) return Response.json({ active: false });
  return Response.json({
    active: true,
    user_id: claims.t,
    username: claims.u,
    scopes: ["mcp:read", "mcp:write"],
    expires_at_unix: claims.e,
  });
}
