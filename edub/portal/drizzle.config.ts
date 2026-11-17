import "dotenv/config";
import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

loadEnv({ path: ".env.local" });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.EDUB_DESIGN_DATABASE_URL ?? "" },
} satisfies Config;
