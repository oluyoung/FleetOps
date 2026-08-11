import crypto from "node:crypto";
import type { Pool } from "pg";
import type { TelemetrySource } from "@repo/contracts";

/**
 * Per ADR-005: adapters own provider ID mapping. Identity-establishing
 * sources (OpenSky, MQTT) resolve their raw provider identifier through this
 * before it ever becomes a CanonicalTelemetryEvent's vehicleId, so vehicleId
 * is always FleetOps-owned rather than a provider's id format/namespace.
 * Enrichment sources (Open-Meteo) never call this — they already read
 * vehicleId off an existing vehicle (RFC-001: enrichment never establishes
 * identity).
 */
export interface VehicleIdentityResolver {
  resolve(source: TelemetrySource, providerRef: string): Promise<string>;
}

export class PostgresVehicleIdentityResolver implements VehicleIdentityResolver {
  constructor(private readonly db: Pool) {}

  async resolve(source: TelemetrySource, providerRef: string): Promise<string> {
    // Get-or-create in one round trip: propose a fresh id, but on conflict
    // (this source/providerRef pair has been seen before) the no-op DO
    // UPDATE still lets RETURNING hand back the vehicle_id already on file,
    // so the same raw provider identifier always converges on one vehicle.
    const proposedId = crypto.randomUUID();
    const result = await this.db.query<{ vehicle_id: string }>(
      `
      INSERT INTO vehicle_identities (id, source, provider_ref, vehicle_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (source, provider_ref) DO UPDATE SET source = EXCLUDED.source
      RETURNING vehicle_id
      `,
      [crypto.randomUUID(), source, providerRef, proposedId],
    );
    return result.rows[0]!.vehicle_id;
  }
}
