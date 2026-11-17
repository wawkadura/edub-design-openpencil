import Link from "next/link";
import { notFound } from "next/navigation";
import { projectForIdentity } from "@/lib/access.ts";
import { listActivity } from "@/lib/projects.ts";
import { ACTION_LABEL, pageAuth } from "@/lib/page-auth.ts";

export const dynamic = "force-dynamic";

export default async function ActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const auth = await pageAuth();
  if ("message" in auth) return <main className="shell"><p className="muted">{auth.message}</p></main>;
  const { slug } = await params;
  const access = await projectForIdentity(auth.identity, slug);
  if (!access) notFound();
  const items = await listActivity(access.project.id, 200);
  return (
    <main className="shell">
      <nav className="crumbs"><Link href="/">Mes projets</Link> / <Link href={`/p/${slug}`}>{access.project.emoji} {access.project.name}</Link> / Activité</nav>
      <h1>Journal d&apos;activité</h1>
      {items.length === 0 ? <p className="muted">Rien pour l&apos;instant.</p> : (
        <ul className="activity">
          {items.map((a) => (
            <li key={a.id}>
              <b>{a.actor.startsWith("agent:") ? `🤖 ${a.actor.slice(6)}` : a.actor}</b> {ACTION_LABEL[a.action] ?? a.action} {a.targetName ? <i>{a.targetName}</i> : null}
              {a.action === "member.set" && a.meta?.role ? <span className="muted"> ({String(a.meta.role)})</span> : null}
              <span className="muted small"> · {a.createdAt.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
