import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

config({ path: ".env.local", quiet: true });
const url = process.env.EDUB_DESIGN_DATABASE_URL;
if (!url) throw new Error("missing EDUB_DESIGN_DATABASE_URL");
const pool = new pg.Pool({ connectionString: url, max: 1 });
await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("migrations OK");
