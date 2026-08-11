import crypto from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { CanonicalTelemetryEvent } from "@repo/contracts";
import { env } from "../env.js";
import { PostgresVehicleRepository } from "./vehicle-repository.js";

// Requires a real Postgres reachable at DATABASE_URL with migrations
// applied: `docker compose up -d postgres && npm run migrate --workspace=api -- up`.
describe("PostgresVehicleRepository", () => {
  const db = new Pool({ connectionString: env.databaseUrl });
  const repository = new PostgresVehicleRepository(db);

  afterAll(async () => {
    await db.end();
  });

  afterEach(async () => {
    await db.query("DELETE FROM vehicle_events");
    await db.query("DELETE FROM vehicles");
  });

  function event(
    overrides: Partial<CanonicalTelemetryEvent> = {},
  ): CanonicalTelemetryEvent {
    return {
      eventId: crypto.randomUUID(),
      vehicleId: "opensky-test-vehicle",
      source: "opensky",
      occurredAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      receivedAt: new Date("2026-01-01T00:00:01.000Z").toISOString(),
      telemetry: { latitude: 51.5, longitude: -0.12, speedMps: 10 },
      ...overrides,
    };
  }

  it("inserts a new vehicle and records a first-seen vehicle_events row", async () => {
    const first = event();

    await repository.upsertFromTelemetry(first);

    const vehicles = await db.query(
      "SELECT * FROM vehicles WHERE id = $1",
      [first.vehicleId],
    );
    expect(vehicles.rowCount).toBe(1);
    expect(vehicles.rows[0].latitude).toBe(51.5);

    const events = await db.query(
      "SELECT * FROM vehicle_events WHERE vehicle_id = $1",
      [first.vehicleId],
    );
    expect(events.rowCount).toBe(1);
  });

  it("updates current state on a newer event without adding a vehicle_events row", async () => {
    const first = event();
    await repository.upsertFromTelemetry(first);

    const newer = event({
      occurredAt: new Date("2026-01-01T00:05:00.000Z").toISOString(),
      telemetry: { latitude: 52.0, longitude: -0.2, speedMps: 20 },
    });
    await repository.upsertFromTelemetry(newer);

    const vehicles = await db.query(
      "SELECT * FROM vehicles WHERE id = $1",
      [first.vehicleId],
    );
    expect(vehicles.rows[0].latitude).toBe(52.0);

    const events = await db.query(
      "SELECT * FROM vehicle_events WHERE vehicle_id = $1",
      [first.vehicleId],
    );
    expect(events.rowCount).toBe(1);
  });

  it("ignores a stale event older than the stored state", async () => {
    const first = event({
      occurredAt: new Date("2026-01-01T00:05:00.000Z").toISOString(),
      telemetry: { latitude: 52.0, longitude: -0.2, speedMps: 20 },
    });
    await repository.upsertFromTelemetry(first);

    const stale = event({
      occurredAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      telemetry: { latitude: 0, longitude: 0, speedMps: 0 },
    });
    await repository.upsertFromTelemetry(stale);

    const vehicles = await db.query(
      "SELECT * FROM vehicles WHERE id = $1",
      [first.vehicleId],
    );
    expect(vehicles.rows[0].latitude).toBe(52.0);
  });

  describe("applyEnrichment", () => {
    function weatherEvent(
      overrides: Partial<CanonicalTelemetryEvent> = {},
    ): CanonicalTelemetryEvent {
      return event({
        source: "open-meteo",
        telemetry: { ambientTemperatureC: 18, windSpeedMps: 4 },
        ...overrides,
      });
    }

    it("no-ops when the vehicle doesn't exist yet", async () => {
      const snapshot = await repository.applyEnrichment(weatherEvent());
      expect(snapshot).toBeNull();

      const vehicles = await db.query("SELECT * FROM vehicles WHERE id = $1", [
        "opensky-test-vehicle",
      ]);
      expect(vehicles.rowCount).toBe(0);
    });

    it("sets weather fields without touching position/speed/heading", async () => {
      await repository.upsertFromTelemetry(event());

      const snapshot = await repository.applyEnrichment(weatherEvent());

      expect(snapshot?.ambientTemperatureC).toBe(18);
      expect(snapshot?.windSpeedMps).toBe(4);
      expect(snapshot?.latitude).toBe(51.5);
      expect(snapshot?.speedMps).toBe(10);
    });

    it("does not insert a vehicle_events row", async () => {
      await repository.upsertFromTelemetry(event());
      await repository.applyEnrichment(weatherEvent());

      const events = await db.query(
        "SELECT * FROM vehicle_events WHERE vehicle_id = $1",
        ["opensky-test-vehicle"],
      );
      expect(events.rowCount).toBe(1); // only the first-seen row from OpenSky
    });

    it("is not rejected as stale by a fresher primary-telemetry occurredAt", async () => {
      await repository.upsertFromTelemetry(
        event({ occurredAt: new Date("2026-01-01T12:00:00.000Z").toISOString() }),
      );

      // Weather's observation time is far earlier than the vehicle's latest
      // primary telemetry — it must still apply, since weather staleness is
      // gated on its own weather_updated_at column, not last_updated_at.
      const snapshot = await repository.applyEnrichment(
        weatherEvent({
          occurredAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        }),
      );

      expect(snapshot?.ambientTemperatureC).toBe(18);
    });

    it("ignores a stale enrichment older than the stored weather", async () => {
      await repository.upsertFromTelemetry(event());
      await repository.applyEnrichment(
        weatherEvent({
          occurredAt: new Date("2026-01-01T06:00:00.000Z").toISOString(),
          telemetry: { ambientTemperatureC: 25, windSpeedMps: 2 },
        }),
      );

      const stale = await repository.applyEnrichment(
        weatherEvent({
          occurredAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
          telemetry: { ambientTemperatureC: 5, windSpeedMps: 1 },
        }),
      );

      expect(stale).toBeNull();
      const vehicles = await db.query("SELECT * FROM vehicles WHERE id = $1", [
        "opensky-test-vehicle",
      ]);
      expect(vehicles.rows[0].ambient_temperature_c).toBe(25);
    });
  });
});
