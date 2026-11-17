import Link from "next/link";
import { visibleProjects } from "@/lib/access.ts";
import { isAdmin } from "@/lib/identity.ts";
import { pageAuth, ROLE_LABEL } from "@/lib/page-auth.ts";
import { EditorDefaults } from "./editor-defaults.tsx";
import { NewProjectButton } from "./_components/new-project.tsx";
import { Thumb } from "./_components/thumb.tsx";

export const dynamic = "force-dynamic";

const initials = (s: string) => s.slice(0, 2).toUpperCase();

export default async function Home() {
  const auth = await pageAuth();
  if ("message" in auth) {
    return (
      <main className="shell">
        <h1>Edub Design</h1>
        <p className="muted">{auth.message}</p>
      </main>
    );
  }
  const { identity } = auth;
  const cards = await visibleProjects(identity);
  const admin = isAdmin(identity);
  const archived = admin ? await visibleProjects(identity, { archived: true }) : [];

  return (
    <main className="shell">
      <EditorDefaults />
      {identity.impersonated ? (
        <div className="dev-banner">DEV : impersonation de « {identity.username} » ({identity.groups.join(", ") || "aucun groupe"})</div>
      ) : null}
      <header className="top">
        <div>
          <h1>Mes projets</h1>
          <p className="muted">Edub Design — tu ne vois que les projets qui te sont ouverts.</p>
        </div>
        <div className="who">
          <span>{identity.displayName ?? identity.username}</span>
          {admin ? <span className="chip">admin</span> : null}
          {admin ? <NewProjectButton /> : null}
        </div>
      </header>

      {cards.length === 0 ? (
        <p className="muted">Aucun projet ne t&apos;est ouvert pour l&apos;instant.</p>
      ) : (
        <ul className="project-grid">
          {cards.map((c) => (
            <li key={c.project.id} className="project-card" style={{ borderTopColor: c.project.color ?? "var(--accent)" }}>
              <Link href={`/p/${c.project.slug}`} className="card-link">
                <Thumb fileId={c.latestFile?.id ?? null} label={c.project.emoji ?? "◻"} />
                <div className="card-body">
                  <div className="card-title">
                    <span>{c.project.emoji ?? "📁"}</span> {c.project.name}
                  </div>
                  {c.project.description ? <div className="muted small clamp">{c.project.description}</div> : null}
                  <div className="muted small">
                    {c.fileCount} fichier{c.fileCount > 1 ? "s" : ""} · {c.screenCount} écran{c.screenCount > 1 ? "s" : ""} · {ROLE_LABEL[c.role]}
                  </div>
                  <div className="avatars" aria-label="Membres">
                    {c.members.slice(0, 5).map((m) => (
                      <span key={m.principalKind + m.principal} className={`avatar ${m.principalKind}`} title={`${m.principal} (${m.principalKind === "group" ? "groupe" : "utilisateur"})`}>
                        {initials(m.principal)}
                      </span>
                    ))}
                    {c.members.length > 5 ? <span className="avatar more">+{c.members.length - 5}</span> : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {archived.length ? (
        <section className="project">
          <h2>Archivés</h2>
          <ul className="archived">
            {archived.map((c) => (
              <li key={c.project.id}><Link href={`/p/${c.project.slug}`}>{c.project.emoji} {c.project.name}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
