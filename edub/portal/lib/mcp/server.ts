import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpToken } from "../db/schema.ts";
import { env } from "../env.ts";
import { HttpError } from "../projects.ts";
import { agentIdentity, authenticateToken, callLimiter, journal, touchToken, writeLimiter } from "./auth.ts";
import { ToolError, type Tool, type ToolCtx, type ToolResult } from "./kit.ts";
import { fileTools } from "./tools-files.ts";
import { projectTools } from "./tools-projects.ts";
import { screenTools } from "./tools-screens.ts";

/**
 * Streamable-HTTP MCP endpoint of Edub Design (`/mcp`), stateless: one Server + transport per
 * request, JSON responses. The Bearer is an agent token (`edd_…`); its scopes decide which
 * projects exist for it. Every call is rate-limited and journalled.
 */
export const TOOLS: Tool[] = [...projectTools, ...fileTools, ...screenTools];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
const WRITE_SLACK = 1.4; // base64 inflates 4/3

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });

function argsProject(args: Record<string, unknown>): string | null {
  return typeof args.project === "string" ? args.project.slice(0, 64) : null;
}

async function runTool(ctx: ToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  const started = Date.now();
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
  const project = argsProject(args);
  const finish = (ok: boolean, error: string | null) => journal(ctx.token.id, name.slice(0, 80), project, ok, error, Date.now() - started);
  if (!tool) {
    await finish(false, "unknown tool");
    return { content: [{ type: "text", text: `unknown tool "${name}"` }], isError: true };
  }
  if (!(tool.write ? writeLimiter : callLimiter).take(ctx.token.id)) {
    await finish(false, "rate limited");
    return { content: [{ type: "text", text: "rate limit reached for this token: wait a minute and retry" }], isError: true };
  }
  try {
    const res = await tool.run(ctx, args);
    await finish(!res.isError, res.isError ? "tool error" : null);
    return res;
  } catch (e) {
    const message = e instanceof ToolError || e instanceof HttpError ? e.message : "internal error";
    if (!(e instanceof ToolError || e instanceof HttpError)) console.error("mcp tool failed", name, e);
    await finish(false, message);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function buildServer(ctx: ToolCtx): Server {
  const server = new Server({ name: "edub-design", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({ ...(await runTool(ctx, req.params.name, req.params.arguments)) }));
  return server;
}

export async function handleMcp(req: Request): Promise<Response> {
  const token: McpToken | null = await authenticateToken(req.headers.get("authorization"));
  if (!token) {
    return rpcError(401, -32001, "unauthorized: a valid Edub Design MCP token is required (Authorization: Bearer edd_…)", {
      "www-authenticate": 'Bearer realm="edub-design"',
    });
  }
  if (req.method !== "POST") return rpcError(405, -32000, "method not allowed: this MCP endpoint is stateless, use POST", { allow: "POST" });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES * WRITE_SLACK) return rpcError(413, -32000, `request too large (limit ${MAX_BODY_BYTES} bytes)`);
  await touchToken(token);
  const ctx: ToolCtx = { token, actor: agentIdentity(token), origin: env.publicOrigin };
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close().catch(() => undefined);
  }
}
