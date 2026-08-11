# FleetOps Console

Realtime fleet ops dashboard. Ingests vehicle position (OpenSky), weather
enrichment (Open-Meteo), and simulated vehicle-health telemetry (MQTT) into a
canonical event model, and serves it to a Next.js dashboard via REST
snapshots + WebSocket deltas.

This README is the interim "how to run this" reference. It'll be replaced by
a full operational runbook once the system is built end to end (see
`notes/domain-model.md` for why that doc is deferred).

Architecture decisions live in `docs/` (RFC-001/002, ADR-003 through ADR-012,
PRD). Domain model and flow diagrams live in `notes/`. Milestone-by-milestone
build order is in `../IMPLEMENTATION_PLAN.md`.

## Architecture at a glance

![Telemetry ingestion](notes/diagrams/telemetry-ingestion.png)

More flows: [`notes/diagrams/reconnect-recovery.png`](notes/diagrams/reconnect-recovery.png),
[`notes/diagrams/mqtt-ingestion.png`](notes/diagrams/mqtt-ingestion.png).
Entity model and open questions: [`notes/domain-model.md`](notes/domain-model.md).

## Run it locally

```sh
cp .env.example .env
docker compose up -d   # Postgres + Mosquitto
npm install
npm run migrate --workspace=api -- up
npm run dev             # web (3000), docs (3001), api (4000), telemetry-publisher
```

`node-pg-migrate` (invoked above via the workspace script) doesn't read the
root `.env` on its own — `npm run --workspace` runs with cwd set to
`apps/api`, not the repo root. Either export `DATABASE_URL` in your shell
before running the migrate command, or run it via `turbo run migrate` once
that task exists. `apps/api`'s own process (`npm run dev`/`start`) doesn't
have this problem: it loads `.env` from the repo root explicitly via
`apps/api/src/load-env.ts`, regardless of invoking cwd.

`GET http://localhost:4000/health` should return `{"status":"ok"}` once
Postgres is reachable. `GET /vehicles` and `GET /vehicles/:id` return the
current vehicle snapshot(s) from Postgres (404 for an unknown id), populated
by the OpenSky ingestion loop described below.

`GET /ws` upgrades to a WebSocket connection subscribed to the single
hardcoded `fleet:default` scope (multi-tenancy is out of scope for M1). Every
canonical telemetry event that changes vehicle state is broadcast as a
`vehicle.updated` `RealtimeEvent<VehicleSnapshot>` envelope — no aggregation
yet (that's Milestone 3 / ADR-010).

CORS is open to `WEB_ORIGIN` (default `http://localhost:3000`) so `apps/web`
can call the REST endpoints directly from the browser.

On startup, `apps/api` constructs an `OpenSkyAdapter` and polls it every
`OPENSKY_POLL_INTERVAL_MS` (default 15s), publishing each canonical event onto
the in-process event bus, which drives the Postgres upsert and WebSocket
broadcast above. A failed poll is logged and retried with exponential
backoff (capped, resetting after the next success) rather than crashing the
process or hammering OpenSky (RFC-001 "transient provider failures use
bounded retry/backoff").

To poll authenticated (https://openskynetwork.github.io/opensky-api/rest.html#authentication),
create an API client on your OpenSky account (https://opensky-network.org/my-opensky/account)
and put its `clientId`/`clientSecret` in `apps/web/credentials.json`:

```json
{ "clientId": "...", "clientSecret": "..." }
```

`OpenSkyAdapter` exchanges these for a bearer token (cached, refreshed ~30s
before its ~30min expiry) via OpenSky's OAuth2 client-credentials endpoint,
and re-authenticates once on a `401` before failing a poll. This file is
gitignored — it's never committed. `OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET`
env vars are a fallback if the file isn't present. Without either, the
adapter polls the anonymous `/states/all` endpoint, which rate-limits
aggressively (frequent `429`s) and can leave `/vehicles` empty for long
stretches; `apps/api` logs a warning on startup when no credentials are found.

Alongside OpenSky, `apps/api` also runs a `WeatherAdapter` on its own
`OPEN_METEO_POLL_INTERVAL_MS` timer (default 10min — Open-Meteo's forecast
data updates hourly, so there's no point polling at OpenSky's cadence). It
reads current vehicle positions from `VehicleRepository`, batches them into
one request to Open-Meteo's forecast API (grouping vehicles that round to
the same ~1km location), and publishes an `open-meteo`-sourced canonical
event per vehicle with `ambientTemperatureC`/`windSpeedMps`. This is
enrichment, not primary telemetry (RFC-001): it's persisted through a
separate `VehicleRepository.applyEnrichment` path gated on its own
`weather_updated_at` column, so it can never overwrite position/speed/
heading or lose a staleness race against OpenSky's much fresher timestamps,
and it no-ops silently if a vehicle hasn't been established by OpenSky yet.
Because it runs on its own independent ingestion loop with its own
try/catch + backoff, an Open-Meteo outage or slow response can never block
or delay OpenSky ingestion.

`apps/telemetry-publisher` simulates a fleet of IoT vehicle-health sensors,
publishing battery/motor-temperature/connectivity readings once a second to
`fleet/{vehicleId}/health` on the local Mosquitto broker (`docker-compose.yml`).
`apps/api`'s `MqttAdapter` subscribes to `fleet/+/health` once on startup and
maps each message to a `mqtt`-sourced canonical event — unlike OpenSky/
Open-Meteo it's push-driven rather than polled, so it just buffers messages
as they arrive and the same `startIngestionLoop` (on a fast
`MQTT_POLL_INTERVAL_MS`, default 1s) drains the buffer instead of fetching;
this is what proves the `ProviderAdapter` boundary generalises across
transport shapes, not just providers (ADR-005). It goes through the same
full-overwrite `upsertFromTelemetry` path as OpenSky (it establishes its own
identity rather than enriching one, unlike Open-Meteo). If the broker is
unreachable at startup, `poll()` rejects and the ingestion loop's own backoff
retries the connection — same as any other provider failure.

Both `OpenSkyAdapter` and `MqttAdapter` still map their raw provider payload
to a provider-namespaced id first (`opensky-{icao24}`, `mqtt-{vehicleId}`),
but `apps/api/src/index.ts` wraps each of them in an `IdentityResolvingAdapter`
before handing them to `startIngestionLoop`. That wrapper resolves the
provider-namespaced id through `VehicleIdentityResolver` (backed by the
`vehicle_identities` table, migration `1755200000000_create-vehicle-identities`)
into a FleetOps-owned canonical `vehicleId` (a UUID unrelated to any
provider's id format) before the event is published — the same
`(source, providerRef)` pair always resolves to the same canonical id, so
`vehicleId` is never provider-owned (ADR-005, Step 13). `WeatherAdapter` is
never wrapped: it already reads an existing canonical `vehicleId` off
`VehicleRepository` and resolving it again would mint a spurious second
identity for the same vehicle.

`apps/web` (`http://localhost:3000`) is the fleet dashboard: a table of
vehicles (id, position, speed, heading, connectivity, ambient temperature,
wind speed, last telemetry time) fetched from `GET /vehicles` on load via
TanStack Query, kept live by a
`GET /ws` subscription that applies `vehicle.updated` deltas onto the same
client-side cache — one cache, not REST and WebSocket state living
separately (RFC-002). The connection badge in the header reflects the socket
state (`connecting` / `live` / `closed`); on reconnect the client refetches
the REST snapshot first in case updates were missed while disconnected, then
resumes applying deltas, with exponential backoff (500ms–15s) between
reconnect attempts.

## Workspace layout

- `apps/web` — Next.js fleet dashboard
- `apps/api` — Fastify backend: adapters, in-process event bus, Postgres
  persistence, REST + WebSocket delivery
- `apps/telemetry-publisher` — synthetic MQTT vehicle-health simulator
  (stands in for a real IoT fleet; see `../mqtt publisher.md`)
- `packages/contracts` — shared Zod schemas (`CanonicalTelemetryEvent`,
  realtime event envelope) used by both `api` and `web`, built to `dist/`
  (`npm run build --workspace=@repo/contracts`) so both `apps/api` (tsx/Node,
  `NodeNext` resolution) and `apps/web` (Next.js/Turbopack bundling) resolve
  the same compiled output — `npm run dev` builds it automatically first via
  Turborepo's `^build` dependency
- `packages/ui`, `packages/eslint-config`, `packages/typescript-config` —
  shared workspace tooling

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Run all apps in watch mode via Turborepo |
| `npm run build` | Build all apps/packages |
| `npm run lint` | Lint all workspaces |
| `npm run check-types` | Typecheck all workspaces |
| `npm run test` | Run Vitest across `apps/api` and `packages/contracts` |
| `npm run migrate --workspace=api -- up` | Apply Postgres migrations (`node-pg-migrate`) |
| `npm run migrate --workspace=api -- down` | Roll back the last migration |

`apps/api`'s test suite includes an integration test for `VehicleRepository`
that hits a real Postgres — `npm run test` requires the DB from
`docker compose up -d postgres` to be running and migrated (`npm run migrate
--workspace=api -- up`), not just unit-testable in isolation. CI provisions
its own Postgres service and runs migrations before `npm run test`.

CI (`.github/workflows/ci.yml`) runs lint, check-types, migrate, test, and
build on every push and PR.

## Milestone status

Milestone 1 (single-provider OpenSky vertical slice — adapter → event bus →
Postgres → REST → WebSocket → dashboard) is complete and manually verified
end to end. See [`notes/milestone-1-review.md`](notes/milestone-1-review.md)
for the checkpoint: what was verified, findings (including an `.env`-loading
bug fixed as part of the checkpoint), and confirmation that the
adapter/event-bus/repository boundaries held up before Milestone 2
generalises them to Open-Meteo and MQTT.

Milestone 2 (multi-provider: OpenSky + Open-Meteo + MQTT) is complete. The
Open-Meteo `WeatherAdapter` (`IMPLEMENTATION_PLAN.md` Step 11), the MQTT
`MqttAdapter` (Step 12), and provider ID mapping via
`VehicleIdentityResolver`/`IdentityResolvingAdapter` (Step 13) are wired in
and verified end to end against live Postgres/Open-Meteo/Mosquitto — see the
sections above. The Milestone 2 checkpoint (Step 14) confirmed, by killing
and restarting the MQTT broker mid-run, that a degraded provider (stale
connectivity/battery fields) doesn't stop OpenSky ingestion or REST/WebSocket
delivery, and that the three ingestion loops/adapters recover independently.
See [`notes/milestone-2-review.md`](notes/milestone-2-review.md) for the full
checkpoint: verification performed, findings, and gaps carried into Milestone
3 (no provider-health surface yet — that's Step 18).

Milestone 3 (observability + aggregation, ADR-012/ADR-010) is underway.
Step 15 — structured logging — is done: `apps/api` now builds one Pino
instance (`src/logger.ts`) shared by Fastify (via `loggerInstance`, giving
every HTTP/WS log line a `requestId`) and the non-request-scoped parts of the
pipeline (`InMemoryEventBus`, `RealtimeGateway`, the vehicle-state
subscriber). Per-telemetry-event logging (`provider`, `vehicleId`,
`eventId`, `occurredAt`, `receivedAt`, `ingestionLagMs`) and per-WebSocket
delivery logging (`connectionId`) run at `debug`, not `info`, so the default
`LOG_LEVEL=info` stays quiet under normal ingestion volume — verified by
running the stack at both levels and confirming `debug`-only lines appear
only with `LOG_LEVEL=debug`. WebSocket connect/disconnect log at `info`
(one line per connection, not per message) with a per-connection
`connectionId`.

Step 16 — metrics — is done: `GET /metrics` (`apps/api/src/observability/metrics.ts`)
exposes the full ADR-012 metric set via `prom-client` on a dedicated
`Registry` (no `collectDefaultMetrics()` noise). `telemetry_events_received_total`,
`telemetry_events_rejected_total`, `telemetry_ingestion_lag_ms`,
`provider_errors_total`, and `provider_last_success_timestamp` are all
labelled by `provider` and incremented from `startIngestionLoop` (received/
lag/last-success on every successful poll) and from each adapter's own
mapping loop (rejected, since only the adapter sees the raw payload count
before filtering) — `provider-errors.ts`'s ad-hoc in-memory counter, written
ahead of this step, is gone now that `provider_errors_total` is the real
thing. `websocket_connections_active`/`websocket_reconnect_total` and
`realtime_updates_published_total`/`realtime_delivery_errors_total` are
incremented from `RealtimeGateway`; `realtime_updates_coalesced_total` is
registered but stays at zero until Step 17's aggregation boundary exists to
increment it. Since the server can't distinguish a reconnect from a first
connect on its own, `apps/web`'s `useFleet` now opens `GET /ws?reconnect=true`
on every attempt after its first, and `apps/api` reads that query param.
Verified against the live stack: `/metrics` shows real `opensky`/`open-meteo`/
`mqtt` counts and non-zero `telemetry_ingestion_lag_ms` buckets while
`turbo dev` is running, and `websocket_connections_active`/
`realtime_updates_published_total` increment while a WebSocket client is
connected.

## Tooling decisions

- **Migrations**: `node-pg-migrate` — plain SQL migration files, matching
  ADR-004's lean away from ORM complexity for the MVP.
- **Validation**: `Zod`, shared between `apps/api` and `apps/web` via
  `packages/contracts`.
- **Client data**: `@tanstack/react-query` on `apps/web`, one cache fed by
  both the REST snapshot and WebSocket deltas.
- **Tests**: `Vitest`.
- **Logging**: `Pino` (ADR-012), one shared instance (`apps/api/src/logger.ts`)
  passed to Fastify and injected into everything else that logs, rather than
  each module creating its own or falling back to `console.*`.
- **MQTT source**: no usable public vehicle-health feed exists, so
  `apps/telemetry-publisher` simulates one and publishes to a local
  Mosquitto broker (see `docker-compose.yml`).
