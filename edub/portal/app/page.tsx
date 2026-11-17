import { upsertUser, visibleFiles, type VisibleFile } from "@/lib/access.ts";
import { currentIdentity } from "@/lib/current-user.ts";
import { canUseDesign, isAdmin } from "@/lib/identity.ts";
import { EditorDefaults } from "./editor-defaults.tsx";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { owner: "Propriétaire", editor: "Éditeur", viewer: "Lecteur" } as const;

function editorHref(file: VisibleFile): string {
  return `/editor?tenant=${file.tenantId}`;
}

export default async function Home() {
  const identity = await currentIdentity();
  if (!identity) {
    return (
      <main className="shell">
        <h1>Edub Design</h1>
        <p className="muted">Identité absente : cette page doit être servie derrière Authelia.</p>
      </main>
    );
  }
  if (!canUseDesign(identity)) {
    return (
      <main className="shell">
        <h1>Edub Design</h1>
        <p className="muted">Ton compte ({identity.username}) n&apos;a pas accès à Edub Design. Demande à Walid.</p>
      </main>
    );
  }
  await upsertUser(identity);
  const files = await visibleFiles(identity);
  const byProject = new Map<string, VisibleFile[]>();
  for (const f of files) byProject.set(f.projectName, [...(byProject.get(f.projectName) ?? []), f]);

  return (
    <main className="shell">
      <EditorDefaults />
      {identity.impersonated ? (
        <div className="dev-banner">DEV : impersonation de « {identity.username} » ({identity.groups.join(", ") || "aucun groupe"})</div>
      ) : null}
      <header className="top">
        <div>
          <h1>Edub Design</h1>
          <p className="muted">Le lieu commun de design des apps Edub. Version provisoire.</p>
        </div>
        <div className="who">
          <span>{identity.displayName ?? identity.username}</span>
          {isAdmin(identity) ? <span className="chip">admin</span> : null}
        </div>
      </header>

      {files.length === 0 ? (
        <p className="muted">Aucun projet ne t&apos;est ouvert pour l&apos;instant.</p>
      ) : (
        [...byProject.entries()].map(([project, list]) => (
          <section key={project} className="project">
            <h2>{project}</h2>
            <ul className="files">
              {list.map((f) => (
                <li key={f.id} className="file">
                  <div>
                    <div className="file-name">{f.name}</div>
                    <div className="muted small">{ROLE_LABEL[f.role]}</div>
                  </div>
                  <a className="open" href={editorHref(f)}>
                    Ouvrir l&apos;éditeur
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
