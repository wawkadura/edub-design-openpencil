import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

type Db = NodePgDatabase<typeof schema>;
const globalForDb = globalThis as unknown as { edubDesignDb?: Db; edubDesignPool?: pg.Pool };

/** Lazily-built shared client (nothing connects at import, so `next build` needs no DB). */
export function getDb(): Db {
  if (!globalForDb.edubDesignDb) {
    globalForDb.edubDesignPool = new pg.Pool({ connectionString: env.databaseUrl, max: 5 });
    globalForDb.edubDesignDb = drizzle({ client: globalForDb.edubDesignPool, schema });
  }
  return globalForDb.edubDesignDb;
}

export { schema };
