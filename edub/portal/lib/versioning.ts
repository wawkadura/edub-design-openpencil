import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * One git repository per project: `<projectsDir>/<slug>/`, one `<fileId>.op` per design file,
 * one commit per save (author = the Authelia user). The DB holds metadata; git holds the
 * history that "Restaurer cette version" reads back. All git calls for a project are
 * serialised (a repo does not tolerate concurrent writers).
 */
export type Author = { name: string; email: string };
export type Version = { sha: string; author: string; date: string; message: string };

const SHA_RE = /^[0-9a-f]{7,40}$/;
const FILE_ID_RE = /^[0-9a-f-]{36}$/;
const SLUG_OK = /^[a-z0-9][a-z0-9-]{0,62}$/;

const chains = new Map<string, Promise<unknown>>();
function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
  chains.set(key, next);
  return next;
}

function git(dir: string, args: string[], author?: Author): Promise<string> {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  const who = author ?? { name: "Edub Design", email: "design@edub.fr" };
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = who.name;
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = who.email;
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: dir, env: env as NodeJS.ProcessEnv, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${stderr.trim() || err.message}`));
      else resolve(stdout);
    });
  });
}

function assertSafe(slug: string, fileId?: string) {
  if (!SLUG_OK.test(slug)) throw new Error("invalid project slug");
  if (fileId !== undefined && !FILE_ID_RE.test(fileId)) throw new Error("invalid file id");
}

export function authorFor(username: string): Author {
  return { name: username, email: `${username}@design.edub.fr` };
}

async function ensureRepo(root: string, slug: string): Promise<string> {
  const dir = path.join(root, slug);
  if (!existsSync(path.join(dir, ".git"))) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await git(dir, ["init", "-q", "-b", "main"]);
  }
  return dir;
}

/** Commit `content` as the new state of the file. Returns the new sha, or null if unchanged. */
export async function commitFile(
  root: string,
  slug: string,
  fileId: string,
  content: string,
  author: Author,
  message: string,
): Promise<string | null> {
  assertSafe(slug, fileId);
  return serial(slug, async () => {
    const dir = await ensureRepo(root, slug);
    const rel = `${fileId}.op`;
    await writeFile(path.join(dir, rel), content, { mode: 0o600 });
    await git(dir, ["add", "--", rel]);
    const staged = await git(dir, ["diff", "--cached", "--name-only", "--", rel]);
    if (!staged.trim()) return null;
    await git(dir, ["commit", "-q", "-m", message.slice(0, 200), "--", rel], author);
    return (await git(dir, ["rev-parse", "HEAD"])).trim();
  });
}

export async function listVersions(root: string, slug: string, fileId: string): Promise<Version[]> {
  assertSafe(slug, fileId);
  return serial(slug, async () => {
    const dir = path.join(root, slug);
    if (!existsSync(path.join(dir, ".git"))) return [];
    let out: string;
    try {
      out = await git(dir, ["log", "--format=%H%x1f%an%x1f%aI%x1f%s", "--", `${fileId}.op`]);
    } catch {
      return []; // repo without commit yet
    }
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, author, date, message] = line.split("\x1f");
        return { sha: sha ?? "", author: author ?? "", date: date ?? "", message: message ?? "" };
      });
  });
}

export async function readVersion(root: string, slug: string, fileId: string, sha: string): Promise<string> {
  assertSafe(slug, fileId);
  if (!SHA_RE.test(sha)) throw new Error("invalid version");
  return serial(slug, async () => {
    const dir = path.join(root, slug);
    if (!existsSync(path.join(dir, ".git"))) throw new Error("no history");
    // Refuse a sha that does not touch THIS file (another file's content must never leak across files).
    const exact = (await git(dir, ["log", "--format=%H", "--", `${fileId}.op`])).split("\n");
    if (!exact.some((h) => h.startsWith(sha))) throw new Error("version not found");
    return git(dir, ["show", `${sha}:${fileId}.op`]);
  });
}

/** Current committed content, or null. */
export async function readHead(root: string, slug: string, fileId: string): Promise<string | null> {
  assertSafe(slug, fileId);
  try {
    return await readFile(path.join(root, slug, `${fileId}.op`), "utf8");
  } catch {
    return null;
  }
}

/** Drop a purged file from the tree (history keeps it). */
export async function removeFile(root: string, slug: string, fileId: string, author: Author): Promise<void> {
  assertSafe(slug, fileId);
  return serial(slug, async () => {
    const dir = path.join(root, slug);
    if (!existsSync(path.join(dir, ".git"))) return;
    await rm(path.join(dir, `${fileId}.op`), { force: true });
    await git(dir, ["add", "-A", "--", `${fileId}.op`]);
    const staged = await git(dir, ["diff", "--cached", "--name-only"]);
    if (staged.trim()) await git(dir, ["commit", "-q", "-m", "purge: corbeille", "--", `${fileId}.op`], author);
  });
}
