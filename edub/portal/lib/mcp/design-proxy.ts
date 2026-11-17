import type { Tool } from "./kit.ts";
import { PROJECT_ARG } from "./kit.ts";

/**
 * Design tools delegated to the Rust editor's own MCP (`op-mcp`). The portal adds `project` + `file`
 * (the editor addresses a design file by tenant, never by path: `filePath` is stripped from every call).
 * `write` tools snapshot the live document into the project's git, authored by the token.
 */
export type ProxySpec = { name: string; write: boolean; description: string; properties: Record<string, unknown>; required?: string[] };

const FILE_ARG = { type: "string", description: "Design file id (see list_files / create_file)." } as const;
const PAGE = { type: "string", description: "Target page id or index." } as const;
const CANVAS = { type: "number", description: "Canvas width used by post-processing heuristics." } as const;

export const PROXIED: ProxySpec[] = [
  {
    name: "batch_design",
    write: true,
    description:
      "Insert or refine design content in a stored .op file, then save it as a git version. BUILD PROTOCOL: generate every new UI tree with `script` — a JavaScript program (sandboxed QuickJS) calling I(parent,node) or K(kitRef,parent,overrides), with loops and data arrays. `operations` is only for editing existing nodes: U(\"n1\",{...}), D(\"n1\"), M(\"n1\",null), C(...), R(...), G(...). `nodes_json` is a JSON array of simple leaf descriptors. script / operations / nodes_json are mutually exclusive. Use design_skeleton → design_content → design_refine for a layered screen.",
    properties: {
      script: { type: "string", description: "JavaScript building nodes with I()/K(). Limits: 256 KiB source, 4096 inserts, 2 s." },
      operations: { type: "string", description: "Edit DSL for existing nodes (U/D/M/C/R/G)." },
      nodes_json: { type: "string", description: "JSON array of simple leaf descriptors." },
      postProcess: { type: "boolean" },
      canvasWidth: CANVAS,
      pageId: PAGE,
    },
  },
  {
    name: "design_skeleton",
    write: true,
    description: "Layered design workflow phase 1: create a root frame (a screen) plus section frames in a stored .op file. Then call design_content per section, then design_refine.",
    properties: {
      rootFrame: { type: "object", description: "Root frame: name, width, height, layout, gap, fill, padding." },
      sections: { type: "array", items: { type: "object" }, description: "Section frames; each needs a name and may set height, layout, padding, gap, fill, role, justifyContent, alignItems." },
      styleGuide: { type: "object", description: "Optional style guide metadata." },
      canvasWidth: CANVAS,
      pageId: PAGE,
    },
    required: ["rootFrame", "sections"],
  },
  {
    name: "design_content",
    write: true,
    description: "Layered design workflow phase 2: fill child nodes into a section frame created by design_skeleton.",
    properties: {
      sectionId: { type: "string", description: "Id of the section frame returned by design_skeleton." },
      children: { type: "array", items: { type: "object" }, description: "Child node definitions to insert under the section." },
      postProcess: { type: "boolean", description: "Apply post-processing after insertion (default true)." },
      canvasWidth: CANVAS,
      pageId: PAGE,
    },
    required: ["sectionId", "children"],
  },
  {
    name: "design_refine",
    write: true,
    description: "Layered design workflow phase 3: polish an existing root frame with deterministic cleanup.",
    properties: { rootId: { type: "string", description: "Id of the root frame to refine." }, canvasWidth: CANVAS, pageId: PAGE },
  },
  {
    name: "batch_get",
    write: false,
    description: "Search and read nodes of a stored .op file. With no patterns / nodeIds it returns the top-level children. Supports type/name patterns, nodeIds, parentId, readDepth, searchDepth, pageId.",
    properties: {
      patterns: { type: "array", items: { type: "object", properties: { type: { type: "string" }, name: { type: "string" }, reusable: { type: "boolean" } } } },
      nodeIds: { type: "array", items: { type: "string" } },
      parentId: { type: "string" },
      readDepth: { type: "number" },
      searchDepth: { type: "number" },
      pageId: PAGE,
      resolveRefs: { type: "boolean" },
    },
  },
  {
    name: "list_pages",
    write: false,
    description: "List the page ids and names of a stored .op file.",
    properties: {},
  },
  {
    name: "lint_document",
    write: false,
    description: "Run OpenPencil design lint over a stored .op file, optionally filtered to one node subtree.",
    properties: { nodeId: { type: "string", description: "Optional node id to filter issues to that subtree." } },
  },
];

export const proxySchema = (s: ProxySpec): Tool["inputSchema"] => ({
  type: "object",
  properties: { project: PROJECT_ARG, file: FILE_ARG, ...s.properties },
  required: ["project", "file", ...(s.required ?? [])],
});
