# Milestone 1 review — OpenSky vertical slice

Checkpoint for `IMPLEMENTATION_PLAN.md` Step 10. Manual end-to-end verification
of the adapter → event bus → Postgres → REST → WebSocket → dashboard slice,
plus a short note on whether the architectural boundaries (ADR-005, ADR-006,
ADR-004, ADR-003, RFC-001, RFC-002) held up before generalising to Milestone 2.

## Verification performed

Ran the full local stack (`docker compose up -d` for Postgres, `npm run dev`
for `apps/api` + `apps/web`) against live OpenSky data:

- `GET /health` → `{"status":"ok"}`.
- `GET /vehicles` → live OpenSky-derived canonical vehicle snapshots
  (thousands of aircraft — see "Findings" below).
- `GET /vehicles/:id` → single snapshot for a known id; unknown id → `404`.
- `GET /ws` → connects, and streams `vehicle.updated` `RealtimeEvent` envelopes
  as OpenSky poll results land, with correct `type`/`scope`/`entityId`/
  `sequence`/`payload` shape.
- CORS: `Access-Control-Allow-Origin: http://localhost:3000` present on API
  responses when called with that Origin.
- `apps/web` dashboard (loaded headlessly): renders the fleet table populated
  with live rows (id, position, speed, heading, connectivity, last telemetry
  time) and shows the connection badge as `live` once the WebSocket opens; no
  browser console errors.
- Reconnect-with-backoff and REST-refetch-on-reconnect were verified by code
  inspection of `apps/web/lib/use-fleet.ts` (matches ADR-003's reconnection
  flow — REST resync before resuming deltas, 500ms–15s exponential backoff)
  rather than a live kill/restart, since tearing down `apps/api` under `turbo
  dev` tears down all sibling tasks together in this environment, making a
  clean isolated restart impractical to script. Server-side, `apps/api`
  doesn't crash on client disconnect (confirmed by the WS test round-trip
  above completing and the process continuing to serve subsequent requests).

## Findings

1. **`npm run migrate --workspace=api -- up` didn't pick up the root `.env`.**
   `apps/api` loaded `.env` via a bare `import "dotenv/config"`, which resolves
   relative to `process.cwd()`. Workspace-scoped npm/turbo tasks run with cwd
   set to the package directory (`apps/api`), not the repo root where `.env`
   actually lives — so `DATABASE_URL` (and every other var) was silently
   undefined outside of commands that happened to already have it exported.
   Fixed as part of this checkpoint: added `apps/api/src/load-env.ts`
   (imported first, side-effect only) that loads `.env` from the monorepo
   root via an explicit `import.meta.url`-relative path, so it works
   regardless of invoking cwd. This also fixes `apps/api`'s ordinary `npm run
   dev` path, which had the same bug — `env.ts` reads `process.env` eagerly
   at import time, and ES module import execution order meant `env.js` ran
   *before* the old inline `dotenv.config()` call in `index.ts`, so it never
   actually observed the loaded vars. `.env` was updated locally to include
   the `WEB_ORIGIN`/`NEXT_PUBLIC_*` vars Step 9 added to `.env.example` but
   hadn't yet been copied into `.env`.
2. **OpenSky ingestion is unfiltered — it pulls global state vectors.** `GET
   /vehicles` currently returns ~9,500 rows (every aircraft OpenSky is
   currently tracking worldwide), not a small demo fleet. Functionally
   correct end-to-end, but the unpaginated HTML table this feeds means the
   dashboard renders a very large, ungrouped list. Not a Milestone 1 blocker
   (PRD scope for M1 is "prove the slice," not "curate the fleet"), but worth
   deciding before Milestone 2: either bound the OpenSky query to a bounding
   box (OpenSky's API supports `lamin`/`lomin`/`lamax`/`lomax`), or add
   pagination/virtualisation to the dashboard table. Flagging rather than
   fixing now since it's a scope decision, not a bug.

## Did the boundaries hold?

- **Adapter boundary (ADR-005):** `OpenSkyAdapter` is the only place that
  knows about OpenSky's state-vector array shape; everything downstream only
  ever sees `CanonicalTelemetryEvent`. Confirmed by reading
  `apps/api/src/adapters/opensky.ts` — validation and mapping are fully
  contained there, consistent with the plan for Open-Meteo/MQTT to plug into
  the same seam in Milestone 2.
- **Event bus (ADR-006):** `InMemoryEventBus` is a thin publish/subscribe
  interface; the ingestion loop, Postgres subscriber
  (`vehicle-state-subscriber.ts`), and WebSocket gateway
  (`realtime-gateway.ts`) each subscribe independently and don't know about
  each other. No coupling found that would need to change to add a second
  provider.
- **Persistence (ADR-004):** `VehicleRepository` is the only SQL-aware layer;
  domain/transport code goes through it, not `pg` directly. Stale-event
  handling (don't overwrite newer state) is exercised in
  `vehicle-repository.integration.test.ts`.
- **Delivery (ADR-003/RFC-002):** REST remains the snapshot source of truth;
  WebSocket only ever carries deltas onto the same client cache. No
  aggregation yet, as planned — that's Milestone 3/ADR-010.

No boundary violations found. The adapter/bus/repository seams look ready to
take on Open-Meteo and MQTT in Milestone 2 without rework.

## Outstanding before Milestone 2

- Decide on OpenSky geographic scoping (finding #2 above).
- `README.md`'s "Architecture at a glance" section links to
  `notes/domain-model.md` and `notes/diagrams/*.png` as if they're inside
  this repo; those files currently live one directory above `oxa/` and are
  outside this git repository, so the links are broken from a fresh clone.
  Not fixed here (out of scope for this checkpoint) — worth a follow-up.
