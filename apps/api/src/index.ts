import "./load-env.js";
import { buildApp } from "./app.js";
import { createDbPool } from "./db.js";
import { env } from "./env.js";
import { InMemoryEventBus } from "./event-bus/in-memory-event-bus.js";
import type { DomainEvent } from "./event-bus/domain-events.js";
import { loadOpenSkyCredentials, OpenSkyAdapter } from "./adapters/opensky.js";
import { WeatherAdapter } from "./adapters/open-meteo.js";
import { startIngestionLoop } from "./ingestion/ingestion-loop.js";

const db = createDbPool();
const eventBus = new InMemoryEventBus<DomainEvent>();
const { app, vehicleRepository } = await buildApp({ db, eventBus });

const openSkyCredentials =
  loadOpenSkyCredentials() ??
  (env.openSkyClientId && env.openSkyClientSecret
    ? { clientId: env.openSkyClientId, clientSecret: env.openSkyClientSecret }
    : undefined);

if (!openSkyCredentials) {
  app.log.warn(
    "No OpenSky credentials found (apps/web/credentials.json or " +
      "OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET) — polling OpenSky's " +
      "anonymous endpoint, which is heavily rate-limited and may 429.",
  );
}

const openSkyIngestion = startIngestionLoop({
  adapter: new OpenSkyAdapter(fetch, undefined, undefined, openSkyCredentials),
  eventBus,
  log: app.log,
  pollIntervalMs: env.openSkyPollIntervalMs,
});

// Weather enriches vehicles OpenSky has already established — a failure or
// slow response here runs on its own timer/backoff and can never block or
// delay OpenSky ingestion (RFC-001, PRD §Failure isolation).
const weatherIngestion = startIngestionLoop({
  adapter: new WeatherAdapter(vehicleRepository, fetch),
  eventBus,
  log: app.log,
  pollIntervalMs: env.openMeteoPollIntervalMs,
});

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });

async function shutdown() {
  openSkyIngestion.stop();
  weatherIngestion.stop();
  await app.close();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
