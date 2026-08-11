import "dotenv/config";
import { buildApp } from "./app.js";
import { createDbPool } from "./db.js";
import { env } from "./env.js";
import { InMemoryEventBus } from "./event-bus/in-memory-event-bus.js";
import type { DomainEvent } from "./event-bus/domain-events.js";

const db = createDbPool();
const eventBus = new InMemoryEventBus<DomainEvent>();
const app = buildApp({ db, eventBus });

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });

async function shutdown() {
  await app.close();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
