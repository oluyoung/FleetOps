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
});
