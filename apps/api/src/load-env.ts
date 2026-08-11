import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Workspace tasks (turbo/npm run --workspace) run with cwd = apps/api, but
// .env lives at the monorepo root alongside .env.example — load it
// explicitly rather than relying on dotenv's default process.cwd() lookup.
// Imported first (and only for its side effect) so process.env is populated
// before any other module reads it at import time (e.g. env.ts, db.ts).
dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});
