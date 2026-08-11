import "dotenv/config";
import { buildApp } from "./app.js";
import { createDbPool } from "./db.js";
import { env } from "./env.js";
import { InMemoryEventBus } from "./event-bus/in-memory-event-bus.js";
import type { DomainEvent } from "./event-bus/domain-events.js";
import { OpenSkyAdapter } from "./adapters/opensky.js";
import { startIngestionLoop } from "./ingestion/ingestion-loop.js";

const db = createDbPool();
const eventBus = new InMemoryEventBus<DomainEvent>();
const app = await buildApp({ db, eventBus });

const openSkyIngestion = startIngestionLoop({
  adapter: new OpenSkyAdapter(),
  eventBus,
  log: app.log,
  pollIntervalMs: env.openSkyPollIntervalMs,
});

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });

async function shutdown() {
  openSkyIngestion.stop();
  await app.close();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
