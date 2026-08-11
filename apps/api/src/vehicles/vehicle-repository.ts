import crypto from "node:crypto";
import type { Pool } from "pg";
import type { CanonicalTelemetryEvent } from "@repo/contracts";

/**
 * Per ADR-004: current vehicle state lives in `vehicles`; only meaningful
 * transitions (e.g. first-seen) are appended to `vehicle_events` — raw
 * telemetry is not retained indefinitely.
 */
export interface VehicleRepository {
  upsertFromTelemetry(event: CanonicalTelemetryEvent): Promise<void>;
}

export class PostgresVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Pool) {}

  async upsertFromTelemetry(event: CanonicalTelemetryEvent): Promise<void> {
    const { telemetry } = event;

    // ON CONFLICT ... WHERE guards against stale/out-of-order events in the
    // same round trip as the upsert (no row returned => event.occurredAt was
    // not newer than the stored state, so nothing was written). The
    // `xmax = 0` trick tells us whether this was a first-seen insert, which
    // is the only "meaningful" transition M1 (OpenSky-only, no connectivity
    // signal) can detect.
    const result = await this.db.query<{ inserted: boolean }>(
      `
      INSERT INTO vehicles (
        id, latitude, longitude, altitude_meters, speed_mps,
        heading_degrees, battery_percent, connectivity, last_seen_source,
        last_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        altitude_meters = EXCLUDED.altitude_meters,
        speed_mps = EXCLUDED.speed_mps,
        heading_degrees = EXCLUDED.heading_degrees,
        battery_percent = EXCLUDED.battery_percent,
        connectivity = EXCLUDED.connectivity,
        last_seen_source = EXCLUDED.last_seen_source,
        last_updated_at = EXCLUDED.last_updated_at
      WHERE vehicles.last_updated_at < EXCLUDED.last_updated_at
      RETURNING (xmax = 0) AS inserted
      `,
      [
        event.vehicleId,
        telemetry.latitude ?? null,
        telemetry.longitude ?? null,
        telemetry.altitudeMeters ?? null,
        telemetry.speedMps ?? null,
        telemetry.headingDegrees ?? null,
        telemetry.batteryPercent ?? null,
        telemetry.connectivity ?? null,
        event.source,
        event.occurredAt,
      ],
    );

    if (result.rowCount === 0) {
      // Stale event: occurredAt was not newer than the stored state.
      return;
    }

    const wasFirstSeen = result.rows[0]?.inserted === true;
    if (!wasFirstSeen) return;

    await this.db.query(
      `
      INSERT INTO vehicle_events (
        id, vehicle_id, source, occurred_at, received_at, telemetry
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        crypto.randomUUID(),
        event.vehicleId,
        event.source,
        event.occurredAt,
        event.receivedAt,
        JSON.stringify(telemetry),
      ],
    );
  }
}
