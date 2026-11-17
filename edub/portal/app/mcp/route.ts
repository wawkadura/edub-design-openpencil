import { handleMcp } from "@/lib/mcp/server.ts";

/**
 * Public MCP endpoint of Edub Design (nginx: no Authelia, the Bearer agent token is checked here).
 * Tools, scopes and limits live in `lib/mcp/`; documentation in `edub/docs/mcp.md`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
