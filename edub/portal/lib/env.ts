import { readFileSync } from "node:fs";

/** Read a required env var; throws a clear error at first use instead of failing obscurely. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

export const env = {
  get databaseUrl() {
    return requireEnv("EDUB_DESIGN_DATABASE_URL");
  },
  get tokenSecret() {
    const secret = requireEnv("EDUB_DESIGN_TOKEN_SECRET");
    if (secret.length < 32) throw new Error("EDUB_DESIGN_TOKEN_SECRET too short");
    return secret;
  },
  get publicOrigin() {
    return process.env.EDUB_DESIGN_PUBLIC_ORIGIN ?? "https://design.edub.fr";
  },
  get editorUrl() {
    return process.env.EDUB_DESIGN_EDITOR_URL ?? "http://127.0.0.1:3100";
  },
  get autheliaUrl() {
    return process.env.EDUB_DESIGN_AUTHELIA_URL ?? "http://127.0.0.1:9091";
  },
  get editorDataDir() {
    return process.env.EDUB_DESIGN_EDITOR_DATA_DIR ?? "";
  },
};

let cachedInternalAuth: string | null = null;

/** Shared secret the Rust editor presents in X-OP-Internal-Auth (introspection). */
export function hubInternalAuth(): string {
  if (cachedInternalAuth) return cachedInternalAuth;
  const file = process.env.EDUB_DESIGN_HUB_INTERNAL_AUTH_FILE;
  const value = file ? readFileSync(file, "utf8").trim() : (process.env.EDUB_DESIGN_HUB_INTERNAL_AUTH ?? "");
  if (value.length < 32) throw new Error("hub internal auth secret missing or too short");
  cachedInternalAuth = value;
  return value;
}

export const isProduction = process.env.NODE_ENV === "production";
