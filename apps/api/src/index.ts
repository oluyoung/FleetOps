import "./load-env.js";
import { buildApp } from "./app.js";
import { createDbPool } from "./db.js";
import { env } from "./env.js";
import { InMemoryEventBus } from "./event-bus/in-memory-event-bus.js";
import type { DomainEvent } from "./event-bus/domain-events.js";
import { loadOpenSkyCredentials, OpenSkyAdapter } from "./adapters/opensky.js";
import { WeatherAdapter } from "./adapters/open-meteo.js";
import { MqttAdapter } from "./adapters/mqtt.js";
import { IdentityResolvingAdapter } from "./adapters/identity-resolving-adapter.js";
import { startIngestionLoop } from "./ingestion/ingestion-loop.js";
import { PostgresVehicleIdentityResolver } from "./vehicles/vehicle-identity-resolver.js";

const db = createDbPool();
const eventBus = new InMemoryEventBus<DomainEvent>();
const { app, vehicleRepository } = await buildApp({ db, eventBus });

// Per ADR-005/Step 13: OpenSky and MQTT both establish vehicle identity, so
// both are wrapped to resolve their raw provider id into one FleetOps-owned
// canonical vehicleId (see VehicleIdentityResolver). Open-Meteo is never
// wrapped — it enriches an existing canonical vehicleId and must not mint a
// new identity for it.
const identityResolver = new PostgresVehicleIdentityResolver(db);

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
  adapter: new IdentityResolvingAdapter(
    new OpenSkyAdapter(fetch, undefined, undefined, openSkyCredentials),
    identityResolver,
  ),
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

// Vehicle-health telemetry from apps/telemetry-publisher, streamed over
// MQTT rather than polled — proves the ProviderAdapter boundary generalises
// across transport shapes, not just providers (ADR-005). It runs on its own
// ingestion loop/backoff too, so a broker outage can't affect OpenSky or
// Open-Meteo ingestion.
const mqttAdapter = new MqttAdapter(env.mqttUrl);
const mqttIngestion = startIngestionLoop({
  adapter: new IdentityResolvingAdapter(mqttAdapter, identityResolver),
  eventBus,
  log: app.log,
  pollIntervalMs: env.mqttPollIntervalMs,
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
  mqttIngestion.stop();
  mqttAdapter.disconnect();
  await app.close();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
