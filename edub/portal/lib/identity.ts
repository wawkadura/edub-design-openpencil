/**
 * Who is asking. In production the identity comes ONLY from the Remote-* headers
 * nginx sets from Authelia's answer (a client cannot forge them: nginx overwrites them).
 * In development, EDUB_DESIGN_DEV_USER impersonates a user so several accounts can be
 * tested without Authelia; it is ignored when NODE_ENV=production.
 */
export type Identity = {
  username: string;
  displayName: string | null;
  email: string | null;
  groups: string[];
  /** True when the identity comes from EDUB_DESIGN_DEV_USER (dev only). */
  impersonated: boolean;
};

/** Authelia groups allowed into Edub Design (see edub/deploy/INFRA.md). */
export const DESIGN_GROUPS = ["design", "admin"] as const;

export function parseGroups(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

const USERNAME_RE = /^[a-zA-Z0-9._@-]{1,128}$/;

/** `username[:group1,group2]` → identity. Groups default to `design`. */
export function parseDevUser(raw: string): Identity | null {
  const [name, groups] = raw.split(":", 2);
  const username = (name ?? "").trim();
  if (!USERNAME_RE.test(username)) return null;
  return {
    username,
    displayName: username,
    email: null,
    groups: groups === undefined ? ["design"] : parseGroups(groups),
    impersonated: true,
  };
}

type HeaderSource = { get(name: string): string | null };

export function identityFromHeaders(
  headers: HeaderSource,
  opts: { production: boolean; devUser?: string | undefined },
): Identity | null {
  if (!opts.production) {
    // Dev/test only: per-request impersonation header (end-to-end tests), then the env default.
    const perRequest = headers.get("x-edub-dev-user");
    if (perRequest) return parseDevUser(perRequest);
    if (opts.devUser) return parseDevUser(opts.devUser);
  }
  const username = headers.get("remote-user")?.trim() ?? "";
  if (!USERNAME_RE.test(username)) return null;
  return {
    username,
    displayName: headers.get("remote-name")?.trim() || null,
    email: headers.get("remote-email")?.trim() || null,
    groups: parseGroups(headers.get("remote-groups")),
    impersonated: false,
  };
}

export function canUseDesign(identity: Pick<Identity, "groups">): boolean {
  return identity.groups.some((g) => (DESIGN_GROUPS as readonly string[]).includes(g));
}

/** Authelia `admin` = Walid: sees and administers every project. */
export function isAdmin(identity: Pick<Identity, "groups">): boolean {
  return identity.groups.includes("admin");
}
