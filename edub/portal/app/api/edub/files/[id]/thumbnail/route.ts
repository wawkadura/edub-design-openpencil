import { thumbnailFor } from "@/lib/projects.ts";
import { withFile } from "@/lib/route-guards.ts";

export const dynamic = "force-dynamic";

export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withFile(req, params, {}, async (me, { file, project }) => {
    const png = await thumbnailFor(file, project, me.username);
    if (!png) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=300" } });
  });
