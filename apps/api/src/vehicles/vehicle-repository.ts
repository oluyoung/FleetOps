import crypto from "node:crypto";
import type { Pool } from "pg";
import type { CanonicalTelemetryEvent, VehicleSnapshot } from "@repo/contracts";

interface VehicleRow {
  id: string;
  latitude: number | null;
  longitude: number | null;
  altitude_meters: number | null;
  speed_mps: number | null;
  heading_degrees: number | null;
  battery_percent: number | null;
  connectivity: VehicleSnapshot["connectivity"];
  last_seen_source: VehicleSnapshot["lastSeenSource"];
  last_updated_at: Date;
  ambient_temperature_c: number | null;
  wind_speed_mps: number | null;
  weather_updated_at: Date | null;
}

function toSnapshot(row: VehicleRow): VehicleSnapshot {
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeMeters: row.altitude_meters,
    speedMps: row.speed_mps,
    headingDegrees: row.heading_degrees,
    batteryPercent: row.battery_percent,
    connectivity: row.connectivity,
    lastSeenSource: row.last_seen_source,
    lastUpdatedAt: row.last_updated_at.toISOString(),
    ambientTemperatureC: row.ambient_temperature_c,
    windSpeedMps: row.wind_speed_mps,
    weatherUpdatedAt: row.weather_updated_at
      ? row.weather_updated_at.toISOString()
      : null,
  };
}

/**
 * Per ADR-004: current vehicle state lives in `vehicles`; only meaningful
 * transitions (e.g. first-seen) are appended to `vehicle_events` — raw
 * telemetry is not retained indefinitely.
 */
export interface VehicleRepository {
  upsertFromTelemetry(
    event: CanonicalTelemetryEvent,
  ): Promise<VehicleSnapshot | null>;
  applyEnrichment(
    event: CanonicalTelemetryEvent,
  ): Promise<VehicleSnapshot | null>;
  findAll(): Promise<VehicleSnapshot[]>;
  findById(id: string): Promise<VehicleSnapshot | null>;
}

export class PostgresVehicleRepository implements VehicleRepository {
  constructor(private readonly db: Pool) {}

  async upsertFromTelemetry(
    event: CanonicalTelemetryEvent,
  ): Promise<VehicleSnapshot | null> {
    const { telemetry } = event;

    // ON CONFLICT ... WHERE guards against stale/out-of-order events in the
    // same round trip as the upsert (no row returned => event.occurredAt was
    // not newer than the stored state, so nothing was written). The
    // `xmax = 0` trick tells us whether this was a first-seen insert, which
    // is the only "meaningful" transition M1 (OpenSky-only, no connectivity
    // signal) can detect.
    const result = await this.db.query<VehicleRow & { inserted: boolean }>(
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
      RETURNING *, (xmax = 0) AS inserted
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
      return null;
    }

    const row = result.rows[0]!;
    const wasFirstSeen = row.inserted === true;
    if (wasFirstSeen) {
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

    return toSnapshot(row);
  }

  // Enrichment (Open-Meteo) is persisted separately from primary telemetry:
  // only the weather columns are written, gated on their own
  // weather_updated_at column rather than the shared last_updated_at, so
  // Open-Meteo's coarser (hourly) timestamps never lose a staleness race
  // against fresher position telemetry, and never null out position/speed/
  // heading. No-ops if the vehicle doesn't exist yet — enrichment attaches
  // to a vehicle established by primary telemetry, never creates one.
  async applyEnrichment(
    event: CanonicalTelemetryEvent,
  ): Promise<VehicleSnapshot | null> {
    const { telemetry } = event;

    const result = await this.db.query<VehicleRow>(
      `
      UPDATE vehicles SET
        ambient_temperature_c = $2,
        wind_speed_mps = $3,
        weather_updated_at = $4
      WHERE id = $1
        AND (weather_updated_at IS NULL OR weather_updated_at < $4)
      RETURNING *
      `,
      [
        event.vehicleId,
        telemetry.ambientTemperatureC ?? null,
        telemetry.windSpeedMps ?? null,
        event.occurredAt,
      ],
    );

    if (result.rowCount === 0) return null;
    return toSnapshot(result.rows[0]!);
  }

  async findAll(): Promise<VehicleSnapshot[]> {
    const result = await this.db.query<VehicleRow>(
      `SELECT id, latitude, longitude, altitude_meters, speed_mps,
              heading_degrees, battery_percent, connectivity,
              last_seen_source, last_updated_at, ambient_temperature_c,
              wind_speed_mps, weather_updated_at
       FROM vehicles
       ORDER BY id`,
    );
    return result.rows.map(toSnapshot);
  }

  async findById(id: string): Promise<VehicleSnapshot | null> {
    const result = await this.db.query<VehicleRow>(
      `SELECT id, latitude, longitude, altitude_meters, speed_mps,
              heading_degrees, battery_percent, connectivity,
              last_seen_source, last_updated_at, ambient_temperature_c,
              wind_speed_mps, weather_updated_at
       FROM vehicles
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toSnapshot(row) : null;
  }
}
