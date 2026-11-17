import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/index.ts";
import { env } from "@/lib/env.ts";

export const dynamic = "force-dynamic";

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const [db, editor] = await Promise.all([
    check(() => getDb().execute(sql`select 1`)),
    check(async () => {
      // The editor's static page is anonymous; any 200 proves the daemon is up.
      const res = await fetch(`${env.editorUrl}/`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(String(res.status));
    }),
  ]);
  const ok = db && editor;
  return Response.json({ ok, db, editor, service: "edub-design-portal" }, { status: ok ? 200 : 503 });
}
