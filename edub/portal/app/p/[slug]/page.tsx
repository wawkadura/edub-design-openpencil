import Link from "next/link";
import { notFound } from "next/navigation";
import { membersOf, projectForIdentity } from "@/lib/access.ts";
import { folderTree, listFiles, purgeExpired } from "@/lib/projects.ts";
import { canManage, canWrite } from "@/lib/rights.ts";
import { pageAuth, ROLE_LABEL } from "@/lib/page-auth.ts";
import { FileCard } from "../../_components/file-card.tsx";
import { FolderActions } from "../../_components/folder-actions.tsx";
import { ProjectToolbar } from "../../_components/project-toolbar.tsx";
import { ShareButton } from "../../_components/share-dialog.tsx";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ folder?: string; trash?: string }> }) {
  const auth = await pageAuth();
  if ("message" in auth) return <main className="shell"><p className="muted">{auth.message}</p></main>;
  const { slug } = await params;
  const sp = await searchParams;
  // No right = the project does not exist for this user.
  const access = await projectForIdentity(auth.identity, slug);
  if (!access) notFound();
  const { project, role } = access;
  await purgeExpired(project);

  const trash = sp.trash === "1";
  const [folders, files, members] = await Promise.all([folderTree(project.id), listFiles(project.id, { trash }), canManage(role) ? membersOf(project.id) : Promise.resolve([])]);
  const current = !trash && sp.folder ? folders.find((f) => f.id === sp.folder) ?? null : null;
  const children = folders.filter((f) => (f.parentId ?? null) === (current?.id ?? null));
  const shown = trash ? files : files.filter((f) => (f.folderId ?? null) === (current?.id ?? null));
  const crumbs: { id: string; name: string }[] = [];
  for (let f = current; f; f = f.parentId ? folders.find((x) => x.id === f!.parentId) ?? null : null) crumbs.unshift(f);
  const write = canWrite(role);

  return (
    <main className="shell">
      <nav className="crumbs"><Link href="/">Mes projets</Link> / <Link href={`/p/${slug}`}>{project.emoji} {project.name}</Link>{crumbs.map((c) => <span key={c.id}> / <Link href={`/p/${slug}?folder=${c.id}`}>{c.name}</Link></span>)}</nav>
      <header className="top">
        <div>
          <h1>{project.emoji} {project.name}</h1>
          {project.description ? <p className="muted">{project.description}</p> : null}
          <p className="muted small">{ROLE_LABEL[role]}{project.archived ? " · archivé" : ""}</p>
        </div>
        <div className="who">
          <Link className="btn" href={`/p/${slug}/activity`}>Activité</Link>
          {canManage(role) ? <ShareButton slug={slug} members={members.map((m) => ({ kind: m.principalKind, principal: m.principal, role: m.role }))} /> : null}
        </div>
      </header>

      <div className="tabs">
        <Link className={!trash ? "tab on" : "tab"} href={`/p/${slug}`}>Fichiers</Link>
        <Link className={trash ? "tab on" : "tab"} href={`/p/${slug}?trash=1`}>Corbeille</Link>
      </div>
      {write && !trash ? <ProjectToolbar slug={slug} folderId={current?.id ?? null} /> : null}
      {trash ? <p className="muted small">Les fichiers supprimés sont conservés 30 jours.</p> : null}

      {!trash && children.length ? (
        <ul className="folders">
          {children.map((f) => (
            <li key={f.id}><Link href={`/p/${slug}?folder=${f.id}`}>📁 {f.name}</Link>{write ? <FolderActions slug={slug} id={f.id} name={f.name} /> : null}</li>
          ))}
        </ul>
      ) : null}

      {shown.length === 0 ? (
        <p className="muted">{trash ? "La corbeille est vide." : "Aucun fichier ici."}</p>
      ) : (
        <ul className="file-grid">
          {shown.map((f) => (
            <FileCard key={f.id} canWrite={write} folders={folders.map((x) => ({ id: x.id, name: x.name }))} file={{ id: f.id, name: f.name, tenantId: f.tenantId, folderId: f.folderId, screenCount: f.screenCount, updatedAt: f.updatedAt.toISOString(), trashed: trash }} />
          ))}
        </ul>
      )}
    </main>
  );
}
