# FleetOps Console

Realtime fleet ops dashboard. Ingests vehicle position (OpenSky), weather
enrichment (Open-Meteo), and simulated vehicle-health telemetry (MQTT) into a
canonical event model, and serves it to a Next.js dashboard via REST
snapshots + WebSocket deltas.

## Run it locally

```sh
cp .env.example .env
make dev   # infra containers + migrations + all apps via turbo dev
```

`make dev` brings up Postgres/Mosquitto/Prometheus/Grafana
(`docker compose up -d`), applies Postgres migrations, then runs
`npm run dev` (web on 3000, docs on 3001, api on 4000, telemetry-publisher).
Ctrl-C stops the apps; the infra containers keep running in the background —
`make down` stops and removes them, `make stop` just stops them, `make clean`
also drops their data volumes.

See the `Makefile` for the individual targets (`up`, `down`, `stop`,
`migrate`, `migrate-down`, `install`, `build`, `lint`, `check-types`, `test`,
`clean`). Everything below can also be run without `make`, using plain
`npm`/`docker compose` commands directly.

```sh
docker compose up -d   # Postgres + Mosquitto + Prometheus + Grafana
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
by the OpenSky ingestion loop described below. `GET /providers/health`
returns a `HEALTHY`/`DEGRADED` status per provider, derived from the
`/metrics` counters (details in Observability below) — `apps/web`'s
dashboard polls this to render the badge strip above the fleet table.

`GET /ws` upgrades to a WebSocket connection subscribed to the single
hardcoded `fleet:default` scope (multi-tenancy is out of scope for the MVP).
Every canonical telemetry event that changes vehicle state is broadcast as a
`vehicle.updated` `RealtimeEvent<VehicleSnapshot>` envelope.
`vehicle.updated` is replaceable telemetry: updates for the same vehicle
arriving within one `TELEMETRY_PUSH_INTERVAL_MS` window (default 500ms) are
coalesced in `RealtimeGateway`, and only the latest is delivered on the next
flush tick. Critical domain event types (`vehicle.offline`, `vehicle.faulted`
— not yet emitted anywhere; provider health is a separate REST-polled
concern rather than a domain event) bypass aggregation and deliver
immediately. Each
connection also has a bounded, drop-oldest delivery queue so one slow client
can't back up delivery to the rest.

CORS is open to `WEB_ORIGIN` (default `http://localhost:3000`) so `apps/web`
can call the REST endpoints directly from the browser.

On startup, `apps/api` constructs an `OpenSkyAdapter` and polls it every
`OPENSKY_POLL_INTERVAL_MS` (default 15s), publishing each canonical event onto
the in-process event bus, which drives the Postgres upsert and WebSocket
broadcast above. A failed poll is logged and retried with exponential
backoff (capped, resetting after the next success) rather than crashing the
process or hammering OpenSky.

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
enrichment, not primary telemetry: it's persisted through a
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
transport shapes, not just providers. It goes through the same
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
`vehicleId` is never provider-owned. `WeatherAdapter` is
never wrapped: it already reads an existing canonical `vehicleId` off
`VehicleRepository` and resolving it again would mint a spurious second
identity for the same vehicle.

`apps/web` (`http://localhost:3000`) is the fleet dashboard: a table of
vehicles (id, position, speed, heading, connectivity, ambient temperature,
wind speed, last telemetry time) fetched from `GET /vehicles` on load via
TanStack Query, kept live by a
`GET /ws` subscription that applies `vehicle.updated` deltas onto the same
client-side cache — one cache, not REST and WebSocket state living
separately. The connection badge in the header reflects the socket
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

| Command | `make` equivalent | What it does |
|---|---|---|
| `docker compose up -d` | `make up` | Start Postgres/Mosquitto/Prometheus/Grafana |
| `docker compose down` | `make down` | Stop and remove the infra containers |
| `npm install` | `make install` | Install workspace dependencies |
| `npm run dev` | `make dev` | Infra up + migrate, then run all apps in watch mode via Turborepo |
| `npm run build` | `make build` | Build all apps/packages |
| `npm run lint` | `make lint` | Lint all workspaces |
| `npm run check-types` | `make check-types` | Typecheck all workspaces |
| `npm run test` | `make test` | Run Vitest across `apps/api` and `packages/contracts` |
| `npm run migrate --workspace=api -- up` | `make migrate` | Apply Postgres migrations (`node-pg-migrate`) |
| `npm run migrate --workspace=api -- down` | `make migrate-down` | Roll back the last migration |

`apps/api`'s test suite includes an integration test for `VehicleRepository`
that hits a real Postgres — `npm run test` requires the DB from
`docker compose up -d postgres` to be running and migrated (`npm run migrate
--workspace=api -- up`), not just unit-testable in isolation. CI provisions
its own Postgres service and runs migrations before `npm run test`.

CI (`.github/workflows/ci.yml`) runs lint, check-types, migrate, test, and
build on every push and PR.

## Observability

`apps/api` builds one Pino instance (`src/logger.ts`) shared by Fastify (via
`loggerInstance`, giving every HTTP/WS log line a `requestId`) and the
non-request-scoped parts of the pipeline (`InMemoryEventBus`,
`RealtimeGateway`, the vehicle-state subscriber). Per-telemetry-event
logging (`provider`, `vehicleId`, `eventId`, `occurredAt`, `receivedAt`,
`ingestionLagMs`) and per-WebSocket delivery logging (`connectionId`) run at
`debug`, not `info`, so the default `LOG_LEVEL=info` stays quiet under
normal ingestion volume. WebSocket connect/disconnect log at `info` (one
line per connection, not per message) with a per-connection `connectionId`.

`GET /metrics` (`apps/api/src/observability/metrics.ts`) exposes Prometheus
metrics via `prom-client` on a dedicated `Registry` (no
`collectDefaultMetrics()` noise): `telemetry_events_received_total`,
`telemetry_events_rejected_total`, `telemetry_ingestion_lag_ms`,
`provider_errors_total`, and `provider_last_success_timestamp` (all labelled
by `provider`), plus `websocket_connections_active`,
`websocket_reconnect_total`, `realtime_updates_published_total`,
`realtime_updates_coalesced_total`, and `realtime_delivery_errors_total`
from `RealtimeGateway`. Since the server can't distinguish a reconnect from
a first connect on its own, `apps/web`'s `useFleet` opens
`GET /ws?reconnect=true` on every attempt after its first, and `apps/api`
reads that query param.

`RealtimeGateway` buffers `vehicle.updated` (replaceable telemetry) per
`(scope, entityId)` and flushes on a `setInterval` tick every
`TELEMETRY_PUSH_INTERVAL_MS` (default 500ms), delivering only the latest
update per vehicle and incrementing `realtime_updates_coalesced_total` for
every update a later one supersedes before flush. Any other
`RealtimeEventType` (`vehicle.offline`, `vehicle.faulted` — critical domain
events; none are emitted yet) skips buffering entirely and delivers on the
same tick it's published. Each connection also gets its own bounded
(50-entry), drop-oldest delivery queue fed at flush time — if a socket's
`bufferedAmount` stays above 1MB (a backpressured/slow client), new flushes
queue instead of piling onto the socket's own send buffer, and the oldest
queued update is dropped (counted as coalesced) once the bound is hit,
rather than growing unbounded.

`GET /providers/health` (`apps/api/src/observability/provider-health.ts`)
derives a `HEALTHY`/`DEGRADED` status per provider straight from the metrics
above — no separate health state is tracked. A provider is `DEGRADED` if it
has never recorded a successful poll, if its last success is older than 3x
its own poll interval (floored at 30s, so a fast poller like MQTT's 1s
buffer-drain doesn't flap on one slow tick), if its average
`telemetry_ingestion_lag_ms` exceeds 30s, or if `provider_errors_total` is
both `>= 3` and more than half of `errors + telemetry_events_received_total`
(a persistent failure ratio, not one startup blip). `apps/web`'s dashboard
polls this endpoint every 5s (`lib/use-provider-health.ts`) and renders a
small `opensky`/`open-meteo`/`mqtt` badge strip above the fleet table,
colored per status. Known gap: `MqttAdapter.poll()` only fails on the
*initial* broker handshake, so a broker outage after startup isn't currently
reflected here.

`docker-compose.yml` also runs `prometheus` (host port 9090) and `grafana`
(host port 3002 — 3001 is `apps/docs`). `infra/prometheus.yml` scrapes
`apps/api`'s `/metrics` at `host.docker.internal:4000` every 5s; since
`apps/api` runs on the host via `turbo dev` rather than as its own Compose
service, the `prometheus` container gets an explicit
`host.docker.internal:host-gateway` `extra_hosts` entry to resolve that back
to the host on Linux. Grafana auto-provisions the Prometheus datasource
(`infra/grafana/provisioning/datasources`, fixed `uid: prometheus`) and a
starter dashboard (`infra/grafana/dashboards/fleetops.json`, "FleetOps
Telemetry") covering events/sec, p95 ingestion lag, rejected events/sec, and
provider errors/sec (all by `provider`), active WebSocket connections,
realtime updates published/coalesced/delivery-errors per second, and a
provider-health staleness proxy panel (seconds since each provider's
`provider_last_success_timestamp`, thresholds at 30s/90s). Grafana allows
anonymous Viewer access (`GF_AUTH_ANONYMOUS_ENABLED`); `admin`/`fleetops`
works for editing.

This Prometheus/Grafana pair is **dev-only**. In production, `fleetops.json`
gets imported into hosted Grafana Cloud instead, and a `grafana-agent`
running as its own Fly.io app (`infra/fly/grafana-agent/`) scrapes
`apps/api`'s `/metrics` over Fly's private network and `remote_write`s to
Grafana Cloud's managed Prometheus — see `DEPLOYMENT.md` at the repo root.

## Tooling decisions

- **Migrations**: `node-pg-migrate` — plain SQL migration files, no ORM.
- **Validation**: `Zod`, shared between `apps/api` and `apps/web` via
  `packages/contracts`.
- **Client data**: `@tanstack/react-query` on `apps/web`, one cache fed by
  both the REST snapshot and WebSocket deltas.
- **Tests**: `Vitest`.
- **Logging**: `Pino`, one shared instance (`apps/api/src/logger.ts`) passed
  to Fastify and injected into everything else that logs, rather than each
  module creating its own or falling back to `console.*`.
- **MQTT source**: no usable public vehicle-health feed exists, so
  `apps/telemetry-publisher` simulates one and publishes to a local
  Mosquitto broker (see `docker-compose.yml`).
