/**
 * op-hub browser-session contract. Edub never hands the editor a session cookie
 * (nginx strips Cookie towards it and injects a per-file Bearer instead), so there
 * is no session to resolve: always a definitive 401.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
