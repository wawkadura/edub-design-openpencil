import { mintEditorToken } from "../editor-token.ts";
import { env } from "../env.ts";

/** One content block of an MCP tool result, as the Rust editor host returns it. */
export type HostContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type HostResult = { content: HostContent[]; isError: boolean };

/**
 * Run an `op-mcp` tool against ONE design file (= editor tenant) through the host's own
 * JSON-RPC endpoint (`POST /mcp?tenant=…`) with the same per-file Bearer the nginx gate injects.
 * The host loads the tenant's document, applies the tool and keeps the result live for open tabs.
 */
export async function hostTool(tenant: string, username: string, name: string, args: Record<string, unknown>): Promise<HostResult> {
  const token = mintEditorToken(env.tokenSecret, tenant, username);
  const res = await fetch(`${env.editorUrl}/mcp?tenant=${tenant}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`editor host answered ${res.status}`);
  const body = (await res.json()) as {
    result?: { content?: HostContent[]; isError?: boolean };
    error?: { message?: string };
  };
  if (body.error) return { content: [{ type: "text", text: body.error.message ?? "editor error" }], isError: true };
  return { content: body.result?.content ?? [], isError: body.result?.isError === true };
}

export const hostText = (r: HostResult): string =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n").trim();
