import Link from "next/link";
import { notFound } from "next/navigation";
import { projectForIdentity } from "@/lib/access.ts";
import { canWrite } from "@/lib/rights.ts";
import { pageAuth } from "@/lib/page-auth.ts";
import { listScreens, listSections, projectTags } from "@/lib/screens.ts";
import { parsePlatform } from "@/lib/screens-model.ts";
import { screenJson } from "@/lib/screens-route.ts";
import type { ScreenCardData } from "../../../_components/screens/labels.ts";
import { FilterBar } from "../../../_components/screens/filter-bar.tsx";
import { ScreenGrid } from "../../../_components/screens/screen-grid.tsx";
import { SectionAdmin } from "../../../_components/screens/section-admin.tsx";
import { Uploader } from "../../../_components/screens/uploader.tsx";

export const dynamic = "force-dynamic";
const KEYS = ["q", "platform", "status", "tag", "ticket", "section", "sort", "type"] as const;

export default async function ScreensPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const auth = await pageAuth();
  if ("message" in auth) return <main className="shell"><p className="muted">{auth.message}</p></main>;
  const { slug } = await params;
  const sp = await searchParams;
  const access = await projectForIdentity(auth.identity, slug);
  if (!access) notFound();
  const { project, role } = access;
  const write = canWrite(role);
  const page = Math.max(1, Number(sp.page) || 1);
  const [sections, tags, res] = await Promise.all([
    listSections(project.id),
    projectTags(project.id),
    listScreens(project, { q: sp.q, platform: sp.platform, status: sp.status, tag: sp.tag, ticket: sp.ticket, type: sp.type, sort: sp.sort, sectionId: sp.section, page }),
  ]);
  const names = new Map(sections.map((s) => [s.id, s.name]));
  const items: ScreenCardData[] = res.items.map((s) => ({ ...screenJson(project, s), sectionName: s.sectionId ? names.get(s.sectionId) ?? null : null }));
  const current: Record<string, string> = {};
  for (const k of KEYS) if (sp[k]) current[k] = sp[k]!;
  const qs = (extra: Record<string, string>) => `?${new URLSearchParams({ ...current, ...extra })}`;
  const { section: _s, ...rest } = current;
  void _s;
  const allHref = `/p/${slug}/screens${Object.keys(rest).length ? `?${new URLSearchParams(rest)}` : ""}`;
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const roots = sections.filter((s) => !s.parentId);
  const activeSection = sections.find((s) => s.id === sp.section);
  const total = (id: string) => sections.filter((s) => s.id === id || s.parentId === id).reduce((n, s) => n + s.count, 0);

  return (
    <main className="shell wide">
      <nav className="crumbs"><Link href="/">Mes projets</Link> / <Link href={`/p/${slug}`}>{project.emoji} {project.name}</Link> / <Link href={`/p/${slug}/screens`}>Écrans</Link></nav>
      <header className="top">
        <div><h1>{project.emoji} Écrans — {project.name}</h1><p className="muted small">{res.total} écran{res.total > 1 ? "s" : ""}{activeSection ? ` · ${activeSection.name}` : ""}</p></div>
      </header>
      <div className="tabs">
        <Link className="tab" href={`/p/${slug}`}>Fichiers</Link>
        <Link className="tab on" href={`/p/${slug}/screens`}>Écrans</Link>
      </div>
      <div className="gallery">
        <aside className="sections" aria-label="Sections">
          <Link className={!sp.section ? "sec on" : "sec"} href={allHref}>Tous les écrans</Link>
          {roots.map((r) => (
            <div key={r.id}>
              <div className="sec-row"><Link className={sp.section === r.id ? "sec on" : "sec"} href={`/p/${slug}/screens${qs({ section: r.id, page: "" })}`}>{r.name} <span className="muted small">{total(r.id)}</span></Link>
                {write ? <SectionAdmin slug={slug} section={{ id: r.id, name: r.name, isRoot: true }} /> : null}</div>
              {sections.filter((c) => c.parentId === r.id).map((c) => (
                <div key={c.id} className="sec-row sub"><Link className={sp.section === c.id ? "sec on" : "sec"} href={`/p/${slug}/screens${qs({ section: c.id, page: "" })}`}>{c.name} <span className="muted small">{c.count}</span></Link>
                  {write ? <SectionAdmin slug={slug} section={{ id: c.id, name: c.name, isRoot: false }} /> : null}</div>
              ))}
            </div>
          ))}
          <Link className={sp.section === "none" ? "sec on" : "sec"} href={`/p/${slug}/screens${qs({ section: "none", page: "" })}`}>Sans section</Link>
          {write ? <SectionAdmin slug={slug} /> : null}
        </aside>
        <section>
          {write ? <Uploader slug={slug} sectionId={sp.section && sp.section !== "none" ? sp.section : null} platform={sp.platform ? parsePlatform(sp.platform) : null} /> : <p className="muted small">Lecture seule : tu vois les écrans sans pouvoir en ajouter.</p>}
          <FilterBar slug={slug} current={current} tags={tags} />
          {items.length === 0 ? <p className="muted">{Object.keys(current).length ? "Aucun écran ne correspond." : "Aucun écran pour l'instant."}</p> : <ScreenGrid slug={slug} items={items} />}
          {pages > 1 ? (
            <nav className="pager" aria-label="Pagination">
              {page > 1 ? <Link className="btn" href={`/p/${slug}/screens${qs({ page: String(page - 1) })}`}>← Précédent</Link> : <span />}
              <span className="muted small">Page {page} / {pages}</span>
              {page < pages ? <Link className="btn" href={`/p/${slug}/screens${qs({ page: String(page + 1) })}`}>Suivant →</Link> : <span />}
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}
