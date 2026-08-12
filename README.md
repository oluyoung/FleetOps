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

`make dev` starts Postgres/Mosquitto/Prometheus/Grafana, applies Postgres
migrations, then runs all apps in watch mode (web on 3000, docs on 3001, api
on 4000, telemetry-publisher). Ctrl-C stops the apps; the infra containers
keep running — `make down` stops and removes them, `make stop` just stops
them, `make clean` also drops their data volumes.

See the `Makefile` for individual targets, or run the same steps directly:

```sh
docker compose up -d   # Postgres + Mosquitto + Prometheus + Grafana
npm install
npm run migrate --workspace=api -- up
npm run dev             # web (3000), docs (3001), api (4000), telemetry-publisher
```

> If you run the migrate command directly (not via `make`), export
> `DATABASE_URL` in your shell first — `npm run --workspace` doesn't pick up
> the root `.env` on its own.

Once Postgres is reachable:
- `GET http://localhost:4000/health` → `{"status":"ok"}`
- `GET /vehicles` and `GET /vehicles/:id` → current vehicle snapshot(s)
- `GET /providers/health` → `HEALTHY`/`DEGRADED` status per provider (drives
  the badge strip on the dashboard)
- `GET /ws` → WebSocket stream of `vehicle.updated` events for the fleet

### How data flows in

- **OpenSky** (vehicle position): polled every `OPENSKY_POLL_INTERVAL_MS`
  (default 15s). Works anonymously but rate-limits aggressively — for
  reliable polling, create an OpenSky API client and put its credentials in
  `apps/web/credentials.json` (gitignored):

  ```json
  { "clientId": "...", "clientSecret": "..." }
  ```

  `OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET` env vars work too if you'd
  rather not use the file.

- **Open-Meteo** (weather enrichment): polled every
  `OPEN_METEO_POLL_INTERVAL_MS` (default 10min). Adds
  `ambientTemperatureC`/`windSpeedMps` to vehicles OpenSky has already
  established — it never overwrites position/speed/heading and runs
  independently, so an Open-Meteo hiccup can't block OpenSky ingestion.

- **MQTT** (simulated vehicle health): `apps/telemetry-publisher` publishes
  battery/motor-temp/connectivity readings once a second; `apps/api`
  subscribes and drains them on a fast internal loop
  (`MQTT_POLL_INTERVAL_MS`, default 1s).

All three sources are wrapped in a common `ProviderAdapter` interface and
funnel through the same ingestion pipeline. OpenSky and MQTT each mint their
own provider-namespaced id, which gets resolved to a stable FleetOps
`vehicleId` (a UUID, not tied to any provider's id format) before anything is
published.

The dashboard (`http://localhost:3000`) loads the initial vehicle table via
REST, then stays live over the `/ws` subscription — one shared cache, kept in
sync by both. A header badge shows the socket state
(`connecting`/`live`/`closed`), and reconnects refetch the REST snapshot
first in case anything was missed.

## Workspace layout

- `apps/web` — Next.js fleet dashboard
- `apps/api` — Fastify backend: adapters, in-process event bus, Postgres
  persistence, REST + WebSocket delivery
- `apps/telemetry-publisher` — synthetic MQTT vehicle-health simulator
  (stands in for a real IoT fleet; see `../mqtt publisher.md`)
- `packages/contracts` — shared Zod schemas used by both `api` and `web`
- `packages/ui`, `packages/eslint-config`, `packages/typescript-config` —
  shared workspace tooling

## Common commands

| Command | `make` equivalent | What it does |
|---|---|---|
| `docker compose up -d` | `make up` | Start Postgres/Mosquitto/Prometheus/Grafana |
| `docker compose down` | `make down` | Stop and remove the infra containers |
| `npm install` | `make install` | Install workspace dependencies |
| `npm run dev` | `make dev` | Infra up + migrate, then run all apps in watch mode |
| `npm run build` | `make build` | Build all apps/packages |
| `npm run lint` | `make lint` | Lint all workspaces |
| `npm run check-types` | `make check-types` | Typecheck all workspaces |
| `npm run test` | `make test` | Run Vitest across `apps/api` and `packages/contracts` |
| `npm run migrate --workspace=api -- up` | `make migrate` | Apply Postgres migrations |
| `npm run migrate --workspace=api -- down` | `make migrate-down` | Roll back the last migration |

`npm run test` needs a running, migrated Postgres (`docker compose up -d
postgres`, then migrate) since `apps/api` includes a real-DB integration
test. CI provisions its own Postgres and runs lint, check-types, migrate,
test, and build on every push and PR.

## Observability

- **Logs**: one shared Pino instance across Fastify and the rest of the
  pipeline. Per-event and per-connection detail logs at `debug`; connect/
  disconnect and request logs at the default `info` level.
- **Metrics**: `GET /metrics` exposes Prometheus counters/gauges for
  telemetry throughput, ingestion lag, provider errors, and WebSocket/
  realtime delivery stats.
- **Provider health**: `GET /providers/health` derives a `HEALTHY`/`DEGRADED`
  badge per provider from those metrics (never polled, always error-prone,
  or laggy). The dashboard polls this every 5s.
- **Dashboards**: `docker-compose.yml` also runs Prometheus (port 9090) and
  Grafana (port 3002), pre-provisioned with a "FleetOps Telemetry" dashboard.
  This pair is dev-only — production ships metrics to Grafana Cloud instead
  (see `DEPLOYMENT.md` at the repo root).

## Tooling decisions

- **Migrations**: `node-pg-migrate` — plain SQL migration files, no ORM.
- **Validation**: `Zod`, shared between `apps/api` and `apps/web` via
  `packages/contracts`.
- **Client data**: `@tanstack/react-query` on `apps/web`, one cache fed by
  both the REST snapshot and WebSocket deltas.
- **Tests**: `Vitest`.
- **Logging**: `Pino`, one shared instance passed to Fastify and everything
  else that logs.
- **MQTT source**: no usable public vehicle-health feed exists, so
  `apps/telemetry-publisher` simulates one and publishes to a local
  Mosquitto broker (see `docker-compose.yml`).
