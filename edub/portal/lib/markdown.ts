import { safeUrl, ticketUrl } from "./screens-model.ts";

/**
 * Tiny markdown subset for descriptions and comments: **bold**, *italic*, `code`, [text](http url),
 * bare URLs, `ED_1234` (→ board), `@member`, "- " lists, line breaks. Everything is HTML-escaped FIRST,
 * and only http(s) links are produced, so the output is safe for dangerouslySetInnerHTML.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function inline(raw: string, members: ReadonlySet<string>): string {
  const codes: string[] = [];
  let s = esc(raw).replace(/`([^`\n]+)`/g, (_m, c: string) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  const links: string[] = [];
  const stash = (html: string) => `\u0001${links.push(html) - 1}\u0001`;
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, text: string, url: string) => {
    const u = safeUrl(url.replace(/&amp;/g, "&"));
    return u ? stash(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`) : m;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre: string, url: string) => {
    const u = safeUrl(url.replace(/&amp;/g, "&"));
    return u ? `${pre}${stash(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`)}` : m;
  });
  s = s.replace(/\bED_\d{3,6}\b/g, (id) => stash(`<a href="${esc(ticketUrl(id))}" target="_blank" rel="noopener noreferrer">${id}</a>`));
  s = s.replace(/(^|[^\w@.])@([a-z0-9][a-z0-9._-]{0,63})/gi, (m, pre: string, name: string) => {
    const n = name.toLowerCase().replace(/[.-]+$/, "");
    return members.has(n) ? `${pre}<span class="mention">@${n}</span>${name.slice(n.length)}` : m;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => links[Number(i)]!).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]!);
}

export function renderMarkdown(src: string, members: Iterable<string> = []): string {
  const set = new Set(members);
  const out: string[] = [];
  let list = false;
  for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(li[1]!, set)}</li>`);
      continue;
    }
    if (list) out.push("</ul>");
    list = false;
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    out.push(h ? `<h4>${inline(h[2]!, set)}</h4>` : line.trim() ? `<p>${inline(line, set)}</p>` : "");
  }
  if (list) out.push("</ul>");
  return out.join("");
}
