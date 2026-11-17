import { notFound } from "@/lib/api.ts";
import { versionBytes, versionOf } from "@/lib/screens.ts";
import { fileHeaders, withScreen } from "@/lib/screens-route.ts";

export const dynamic = "force-dynamic";

/** Raw upload of version `n` (or `current`). Non-members get the same 404 as a missing image. */
export const GET = (req: Request, { params }: { params: Promise<{ slug: string; sid: string; n: string }> }) =>
  withScreen(req, params, {}, async (_me, { project }, s) => {
    const nRaw = (await params).n;
    const v = await versionOf(s, nRaw);
    if (!v) return notFound();
    const headers = fileHeaders(v, nRaw !== "current", new URL(req.url).searchParams.get("download") === "1");
    if (req.headers.get("if-none-match") === headers.get("etag")) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(await versionBytes(project, s, v)), { headers });
  });
