import { headers } from "next/headers";
import { identityFromHeaders, type Identity } from "./identity.ts";
import { isProduction } from "./env.ts";

/** Identity of the current page/route request (Authelia headers, or dev impersonation). */
export async function currentIdentity(): Promise<Identity | null> {
  return identityFromHeaders(await headers(), {
    production: isProduction,
    devUser: process.env.EDUB_DESIGN_DEV_USER,
  });
}
