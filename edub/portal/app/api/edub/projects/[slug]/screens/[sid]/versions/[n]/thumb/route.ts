import { notFound } from "@/lib/api.ts";
import { thumbBytes, versionOf } from "@/lib/screens.ts";
import { withScreen } from "@/lib/screens-route.ts";

export const dynamic = "force-dynamic";

/** WebP thumbnail (480 px). 204 while it cannot be produced: the UI shows a placeholder. */
export const GET = (req: Request, { params }: { params: Promise<{ slug: string; sid: string; n: string }> }) =>
  withScreen(req, params, {}, async (_me, { project }, s) => {
    const nRaw = (await params).n;
    const v = await versionOf(s, nRaw);
    if (!v) return notFound();
    const webp = await thumbBytes(project, s, v);
    if (!webp) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    return new Response(new Uint8Array(webp), {
      headers: { "content-type": "image/webp", "x-content-type-options": "nosniff", "cache-control": nRaw === "current" ? "private, max-age=30" : "private, max-age=31536000, immutable" },
    });
  });
