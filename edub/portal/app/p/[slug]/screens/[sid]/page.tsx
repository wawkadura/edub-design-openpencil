import Link from "next/link";
import { notFound } from "next/navigation";
import { projectForIdentity } from "@/lib/access.ts";
import { renderMarkdown } from "@/lib/markdown.ts";
import { pageAuth } from "@/lib/page-auth.ts";
import { canManage, canWrite } from "@/lib/rights.ts";
import { getScreen, listComments, listSections, mentionable } from "@/lib/screens.ts";
import { ticketUrl } from "@/lib/screens-model.ts";
import { screenJson, versionJson } from "@/lib/screens-route.ts";
import { PLATFORM_LABEL, STATUS_LABEL, TYPE_LABEL } from "../../../../_components/screens/labels.ts";
import { CopyLink } from "../../../../_components/screens/copy-link.tsx";
import { ScreenMeta } from "../../../../_components/screens/screen-meta.tsx";
import { ScreenReview } from "../../../../_components/screens/screen-review.tsx";
import { ScreenThumb } from "../../../../_components/screens/screen-thumb.tsx";
import { Uploader } from "../../../../_components/screens/uploader.tsx";

export const dynamic = "force-dynamic";

export default async function ScreenPage({ params }: { params: Promise<{ slug: string; sid: string }> }) {
  const auth = await pageAuth();
  if ("message" in auth) return <main className="shell"><p className="muted">{auth.message}</p></main>;
  const { slug, sid } = await params;
  const access = await projectForIdentity(auth.identity, slug);
  if (!access) notFound();
  const { project, role } = access;
  const screen = await getScreen(project, sid);
  if (!screen) notFound();
  const [comments, sections, people] = await Promise.all([listComments(screen.id), listSections(project.id), mentionable(project)]);
  const me = auth.identity.username;
  const write = canWrite(role);
  const s = screenJson(project, screen);
  const sectionName = sections.find((x) => x.id === screen.sectionId)?.name;
  const prev = screen.versions[1];

  return (
    <main className="shell wide">
      <nav className="crumbs"><Link href="/">Mes projets</Link> / <Link href={`/p/${slug}`}>{project.emoji} {project.name}</Link> / <Link href={`/p/${slug}/screens`}>Écrans</Link>{sectionName ? <> / <Link href={`/p/${slug}/screens?section=${screen.sectionId}`}>{sectionName}</Link></> : null}</nav>
      <header className="top">
        <div>
          <h1>{screen.title}</h1>
          <p className="muted small">{PLATFORM_LABEL[screen.platform]} · {TYPE_LABEL[screen.type]} · <span className={`chip st-${screen.status.replace(" ", "-")}`}>{STATUS_LABEL[screen.status]}</span> · v{screen.currentVersion} · {screen.authorKind === "agent" ? `agent ${screen.author}` : screen.author} · {screen.updatedAt.toLocaleDateString("fr-FR")}</p>
        </div>
        <div className="who">
          <CopyLink url={s.shareUrl} />
          {prev ? <Link className="btn" href={`/p/${slug}/screens/compare?a=${screen.id}@${prev.n}&b=${screen.id}@${screen.currentVersion}`}>Comparer v{prev.n} ↔ v{screen.currentVersion}</Link> : null}
          {screen.designFileId ? <Link className="btn" href={`/p/${slug}`}>Fichier .op</Link> : null}
        </div>
      </header>

      <div className="detail">
        <div>
          <ScreenReview
            slug={slug} screenId={screen.id} type={screen.type} fileUrl={s.fileUrl} title={screen.title} version={screen.currentVersion} members={people}
            canDelete={canManage(role)}
            comments={comments.map((c) => ({ id: c.id, author: c.author, html: renderMarkdown(c.body, people), pinX: c.pinX, pinY: c.pinY, versionN: c.versionN, createdAt: c.createdAt.toISOString(), mine: c.author === me }))}
          />
        </div>
        <aside className="side">
          {screen.description ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(screen.description, people) }} /> : <p className="muted small">Pas de description.</p>}
          {screen.tags.length ? <div className="chips">{screen.tags.map((t) => <Link key={t} className="chip" href={`/p/${slug}/screens?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}</div> : null}
          {s.links.length ? (
            <ul className="links">
              {s.links.map((l, i) => (
                <li key={i}>{l.type === "ticket" ? <><a href={l.url} target="_blank" rel="noopener noreferrer">{l.ref}</a> · <Link className="small" href={`/p/${slug}/screens?ticket=${l.ref}`}>écrans liés</Link></> : <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.label ?? (l.type === "pr" ? "PR" : l.url)}</a>}</li>
              ))}
            </ul>
          ) : null}
          {write ? <details className="edit"><summary className="btn">Modifier</summary><ScreenMeta slug={slug} screenId={screen.id} sections={sections.map((x) => ({ id: x.id, name: x.name, parentId: x.parentId }))} initial={{ title: screen.title, sectionId: screen.sectionId, platform: screen.platform, status: screen.status, tags: screen.tags, description: screen.description, links: screen.links }} /></details> : null}

          {screen.type !== "design" ? (
            <>
              <h2>Versions ({screen.versions.length})</h2>
              {write ? <Uploader slug={slug} screenId={screen.id} /> : null}
              <ul className="vlist">
                {screen.versions.map((v, i) => {
                  const vj = versionJson(project, screen, v);
                  const older = screen.versions[i + 1];
                  return (
                    <li key={v.n}>
                      <a href={`${vj.fileUrl}`} target="_blank" rel="noopener noreferrer" className="vthumb"><ScreenThumb src={v.hasThumb ? vj.thumbUrl : vj.thumbUrl} type={screen.type} /></a>
                      <div className="small"><b>v{v.n}</b>{v.n === screen.currentVersion ? " (actuelle)" : ""}<br />{v.authorKind === "agent" ? `agent ${v.author}` : v.author}<br /><span className="muted">{v.createdAt.toLocaleString("fr-FR")}{v.width ? ` · ${v.width}×${v.height}` : ""}</span>
                        {v.note ? <><br />{v.note}</> : null}
                        {older ? <><br /><Link href={`/p/${slug}/screens/compare?a=${screen.id}@${older.n}&b=${screen.id}@${v.n}`}>comparer avec v{older.n}</Link></> : null}</div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <p className="muted small">Tickets : {screen.tickets.length ? screen.tickets.map((t) => <a key={t} href={ticketUrl(t)} target="_blank" rel="noopener noreferrer">{t} </a>) : "aucun"}</p>
        </aside>
      </div>
    </main>
  );
}
