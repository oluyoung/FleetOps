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

`GET http://localhost:4000/health` should return `{"status":"ok"}` once
Postgres is reachable. `GET /vehicles` and `GET /vehicles/:id` return the
current vehicle snapshot(s) from Postgres (404 for an unknown id), populated
by the OpenSky ingestion loop described below.

`GET /ws` upgrades to a WebSocket connection subscribed to the single
hardcoded `fleet:default` scope (multi-tenancy is out of scope for M1). Every
canonical telemetry event that changes vehicle state is broadcast as a
`vehicle.updated` `RealtimeEvent<VehicleSnapshot>` envelope — no aggregation
yet (that's Milestone 3 / ADR-010).

On startup, `apps/api` constructs an `OpenSkyAdapter` and polls it every
`OPENSKY_POLL_INTERVAL_MS` (default 15s), publishing each canonical event onto
the in-process event bus, which drives the Postgres upsert and WebSocket
broadcast above. A failed poll is logged and retried with exponential
backoff (capped, resetting after the next success) rather than crashing the
process or hammering OpenSky (RFC-001 "transient provider failures use
bounded retry/backoff").

## Workspace layout

- `apps/web` — Next.js fleet dashboard
- `apps/api` — Fastify backend: adapters, in-process event bus, Postgres
  persistence, REST + WebSocket delivery
- `apps/telemetry-publisher` — synthetic MQTT vehicle-health simulator
  (stands in for a real IoT fleet; see `../mqtt publisher.md`)
- `packages/contracts` — shared Zod schemas (`CanonicalTelemetryEvent`,
  realtime event envelope) used by both `api` and `web`
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

## Tooling decisions

- **Migrations**: `node-pg-migrate` — plain SQL migration files, matching
  ADR-004's lean away from ORM complexity for the MVP.
- **Validation**: `Zod`, shared between `apps/api` and `apps/web` via
  `packages/contracts`.
- **Tests**: `Vitest`.
- **MQTT source**: no usable public vehicle-health feed exists, so
  `apps/telemetry-publisher` simulates one and publishes to a local
  Mosquitto broker (see `docker-compose.yml`).
