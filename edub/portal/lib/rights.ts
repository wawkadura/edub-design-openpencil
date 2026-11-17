import { isAdmin, type Identity } from "./identity.ts";
import type { PrincipalKind, ProjectRole } from "./db/schema.ts";

/**
 * Pure rights model of a project (no I/O, unit-tested in rights.test.ts).
 * A member row grants a role to an Authelia user (`Remote-User`) or group (`Remote-Groups`);
 * the effective role is the strongest one among the user's own row and the rows of every
 * group they belong to. Authelia `admin` is owner of everything.
 */
export type MemberGrant = { principalKind: PrincipalKind; principal: string; role: ProjectRole };

const RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function strongest(a: ProjectRole | null, b: ProjectRole | null): ProjectRole | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export function resolveRole(
  identity: Pick<Identity, "username" | "groups">,
  members: readonly MemberGrant[],
): ProjectRole | null {
  if (isAdmin(identity)) return "owner";
  let role: ProjectRole | null = null;
  for (const m of members) {
    const hit =
      (m.principalKind === "user" && m.principal === identity.username) ||
      (m.principalKind === "group" && identity.groups.includes(m.principal));
    if (hit) role = strongest(role, m.role);
  }
  return role;
}

/** Edit files, create / rename / move / trash, save versions. */
export const canWrite = (role: ProjectRole | null): boolean => role === "editor" || role === "owner";
/** Share, rename the project, archive, restore versions of others. */
export const canManage = (role: ProjectRole | null): boolean => role === "owner";

/** Authelia names are lowercase ASCII, so principals are normalised the same way. */
const PRINCIPAL_RE = /^[a-z0-9][a-z0-9._@-]{0,127}$/;
export function parsePrincipal(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return PRINCIPAL_RE.test(v) ? v : null;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
