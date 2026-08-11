# Milestone 2 review — multi-provider (OpenSky + Open-Meteo + MQTT)

Checkpoint for `IMPLEMENTATION_PLAN.md` Step 14. Verifies that a degraded
provider (Open-Meteo or MQTT) does not stop OpenSky ingestion or dashboard
updates, per PRD "Failure isolation" ("Failure of weather enrichment or
another provider must not stop the primary telemetry pipeline") and the
Success Criteria bullet "one provider can degrade without stopping the
system."

## Verification performed

Ran the full local stack (`docker compose up -d` for Postgres + Mosquitto,
`npm run dev` for `apps/api` + `apps/web` + `apps/telemetry-publisher`)
against live OpenSky data, Open-Meteo, and the synthetic MQTT health
publisher (temporarily set `OPEN_METEO_POLL_INTERVAL_MS=5000` for this
session only, to observe weather refreshes without a 10-minute wait; not
persisted to `.env`).

- `GET /vehicles` returned a mixed fleet: OpenSky rows with live
  position/speed/heading and Open-Meteo-enriched `ambientTemperatureC`, plus
  3 MQTT-sourced rows (`vehicle-001..003`) with `connectivity`/battery from
  the synthetic publisher — confirming Step 13's identity convergence is
  working (each MQTT vehicle keeps one stable canonical id across polls
  rather than duplicating).
- **Killed MQTT** (`docker compose stop mqtt`) mid-run. Over the following
  ~30s: OpenSky-sourced `lastUpdatedAt` timestamps kept advancing on every
  poll cycle (e.g. `21:55:20` → `21:55:27` → `21:55:28`), while the 3 MQTT
  rows froze at their last-received value (`21:55:08`) and did not error out
  or disappear — connectivity/battery fields simply went stale, exactly as
  the Step-12/13 design implies (no "provider down" UI surface exists yet;
  that's Milestone 3 Step 18). `apps/api` logged no errors and its process
  stayed up throughout — `mqtt.js`'s built-in reconnect absorbs the broker
  drop silently after the initial connect, so `IoTAdapter`'s ingestion loop
  never even entered its `catch` branch during this test.
- **Restarted MQTT** (`docker compose start mqtt`): the 3 MQTT rows resumed
  fresh updates within ~10s (client auto-reconnected), no restart of
  `apps/api` needed.
- `GET /ws` (checked via a short Python `websockets` script rather than the
  browser, per the milestone-1 note's precedent): connects and streams
  `vehicle.updated` envelopes with the full canonical shape (`id`, position,
  `batteryPercent`, `connectivity`, `lastSeenSource`, `ambientTemperatureC`,
  etc.) for the MQTT vehicles even while the broker had just been restarted,
  confirming the WS path degrades and recovers the same way REST does since
  both read off the same repository/event-bus path.
- `apps/web` (`GET /` → 200) was not exercised against a live MQTT outage in
  a browser this round; `apps/web/lib/use-fleet.ts` is unchanged since the
  Milestone 1 checkpoint (still REST snapshot + WS deltas, same
  reconnect/backoff logic already verified there), and the dashboard has no
  provider-specific rendering that could newly break — it renders whatever
  `GET /vehicles`/WS give it, which the above confirms keeps flowing.
- Did not kill Open-Meteo directly (no locally-hostable stand-in); isolation
  for it rests on the same shared code path verified by killing MQTT —
  `ingestion-loop.ts`'s `runOnce()` wraps every adapter's `poll()` in one
  `try/catch` per independently-scheduled loop (see "Did the isolation
  design hold?" below) — plus static confirmation that `WeatherAdapter.poll`
  throws only on its own HTTP call, caught only by its own loop.

## Did the isolation design hold?

- **Three independent ingestion loops**, not a shared one: `apps/api/src/index.ts`
  starts a separate `startIngestionLoop` for OpenSky, Open-Meteo, and MQTT,
  each with its own `setTimeout` chain and backoff state. A failure in one
  can only affect its own reschedule delay — confirmed empirically for MQTT
  above, and true by construction for Open-Meteo (same `runOnce()` function,
  same non-shared timer).
- **Per-loop catch records the error and backs off, rather than propagating**:
  `ingestion-loop.ts`'s `catch` block calls `recordProviderError(adapter.source)`,
  logs, and doubles the backoff — it never rethrows or touches the other
  loops.
- **Vehicle identity (Step 13)** held up under a provider outage/recovery
  cycle: MQTT vehicles kept the same 3 canonical ids across the kill/restart,
  no duplicate rows appeared.

## Findings / gaps

1. **No visible "provider degraded" signal today.** MQTT rows going stale
   during the outage was only detectable by comparing `lastUpdatedAt`
   timestamps by hand — there's no dashboard badge or `/providers/health`
   endpoint yet. This is explicitly scheduled for Milestone 3 Step 18, so
   not a Milestone 2 gap, but worth flagging so it isn't mistaken for "the
   system doesn't know" — `provider_errors_total`-shaped state already
   exists in-memory (`apps/api/src/observability/provider-errors.ts`) and
   just isn't exposed on an endpoint yet (Step 16).
2. **`OPEN_METEO_POLL_INTERVAL_MS` is documented in `.env.example` but not
   set in the working `.env`**, so it silently falls back to the 600000ms
   (10 min) default in `env.ts`. Functionally fine, but slow for anyone
   manually verifying weather enrichment locally without overriding it like
   this checkpoint did. Not changing `.env` here since the default is a
   deliberate low-traffic choice for the free Open-Meteo API, not a bug.
3. **mqtt.js's silent auto-reconnect means a broker outage never surfaces in
   `apps/api` logs at all** (no reconnect/offline log lines were emitted
   during the ~30s outage in this test). Fine for Milestone 2's bar (don't
   crash), but means Milestone 3's observability work needs to attach its
   own listeners to `mqtt.js` connection events if MQTT connectivity itself
   should show up as a health signal — `IoTAdapter.ensureConnected` currently
   only throws on the *initial* connect, not on later drops.

## Outstanding before Milestone 3

- Provider health derivation (Step 18) and `/metrics` (Step 16) will give
  the counter recorded in `provider-errors.ts` — and MQTT connection
  state — somewhere to surface to.
- The Milestone 1 note's outstanding item (OpenSky geo-scoping) was resolved
  by the "bound OpenSky ingestion to a fixed 15-vehicle fleet" commit
  (3a5d010); the other outstanding item (broken `notes/domain-model.md`
  links in `README.md`) is still open.
