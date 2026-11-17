/**
 * Public MCP endpoint (nginx: no Authelia, Bearer checked here). Not served yet:
 * the agent MCP (per-file tools proxied to the editor's tenant MCP) is a later
 * ticket — see docs/edub/2026-11-16-edub-design-spec.md §MCP.
 */
export const dynamic = "force-dynamic";

function unauthorized(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "unauthorized: Edub Design MCP token required" }, id: null },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="edub-design"' } },
  );
}

export const GET = unauthorized;
export const POST = unauthorized;
