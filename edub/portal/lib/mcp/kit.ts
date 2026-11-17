import type { McpToken } from "../db/schema.ts";
import type { Identity } from "../identity.ts";
import { projectForToken, type TokenProjectAccess } from "./auth.ts";

/** Plumbing shared by the MCP tools: context, result shapes, argument readers. */
export type Block = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type ToolResult = { content: Block[]; isError?: boolean };
export type ToolCtx = { token: McpToken; actor: Identity; origin: string };
export type Tool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Writes need `editor` on the project and use the tighter rate-limit. */
  write?: boolean;
  run(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolResult>;
};

/** An error the agent is meant to read (explicit, actionable). */
export class ToolError extends Error {}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });
export const json = (v: unknown): ToolResult => text(JSON.stringify(v, null, 2));
export const withImage = (v: unknown, data: Buffer, mimeType: string): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(v, null, 2) }, { type: "image", data: data.toString("base64"), mimeType }],
});

export function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolError(`missing required argument "${key}"`);
    return undefined;
  }
  if (typeof v !== "string") throw new ToolError(`argument "${key}" must be a string`);
  return v;
}

export function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ToolError(`argument "${key}" must be a number`);
  return v;
}

/** Same wording whether the project is missing or out of scope: the token must not learn which. */
export const projectNotFound = (slug: unknown) => new ToolError(`project "${String(slug)}" not found`);

export async function needProject(ctx: ToolCtx, args: Record<string, unknown>, write: boolean): Promise<TokenProjectAccess> {
  const slug = str(args, "project", true);
  const access = await projectForToken(ctx.token, slug);
  if (!access) throw projectNotFound(slug);
  if (write && access.role !== "editor") {
    throw new ToolError(`read-only: this token has "${access.role}" access to project "${slug}" and cannot write`);
  }
  return access;
}

export const PROJECT_ARG = { type: "string", description: "Project slug (see list_projects)." } as const;
