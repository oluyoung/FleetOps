import { Pool } from "pg";
import { env } from "./env.js";

export function createDbPool(): Pool {
  return new Pool({ connectionString: env.databaseUrl });
}
