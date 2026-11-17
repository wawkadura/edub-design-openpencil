import Link from "next/link";
import { notFound } from "next/navigation";
import { projectForIdentity } from "@/lib/access.ts";
import { pageAuth } from "@/lib/page-auth.ts";
import { getScreen, versionOf } from "@/lib/screens.ts";
import { CompareView, type Side } from "../../../../_components/screens/compare-view.tsx";

export const dynamic = "force-dynamic";

/** `?a=<screenId>[@n]&b=<screenId>[@n]` — two versions of one screen, or two screens. */
export default async function ComparePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const auth = await pageAuth();
  if ("message" in auth) return <main className="shell"><p className="muted">{auth.message}</p></main>;
  const { slug } = await params;
  const sp = await searchParams;
  const access = await projectForIdentity(auth.identity, slug);
  if (!access) notFound();
  const side = async (ref?: string): Promise<Side | null> => {
    const [id, n] = (ref ?? "").split("@");
    const screen = id ? await getScreen(access.project, id) : null;
    const v = screen ? await versionOf(screen, n || "current") : null;
    if (!screen || !v) return null;
    return { label: `${screen.title} · v${v.n}`, src: `/api/edub/projects/${slug}/screens/${screen.id}/versions/${v.n}/file`, kind: v.kind === "html" ? "html" : "image", w: v.width, h: v.height };
  };
  const [a, b] = await Promise.all([side(sp.a), side(sp.b)]);
  if (!a || !b) notFound();
  return (
    <main className="shell wide">
      <nav className="crumbs"><Link href="/">Mes projets</Link> / <Link href={`/p/${slug}`}>{access.project.emoji} {access.project.name}</Link> / <Link href={`/p/${slug}/screens`}>Écrans</Link> / Comparer</nav>
      <h1>Comparer</h1>
      <CompareView a={a} b={b} />
    </main>
  );
}
