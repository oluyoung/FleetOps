import { z } from "zod";
import { TelemetrySourceSchema } from "./telemetry.js";

/**
 * Current-state read model per ADR-003/ADR-004: what `GET /vehicles` and
 * `GET /vehicles/:id` return — the authoritative snapshot, not raw telemetry.
 */
export const VehicleSnapshotSchema = z.object({
  id: z.string().min(1),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  altitudeMeters: z.number().nullable(),
  speedMps: z.number().nullable(),
  headingDegrees: z.number().nullable(),
  batteryPercent: z.number().nullable(),
  connectivity: z.enum(["good", "degraded", "offline"]).nullable(),
  lastSeenSource: TelemetrySourceSchema.nullable(),
  lastUpdatedAt: z.string().datetime(),
  ambientTemperatureC: z.number().nullable(),
  windSpeedMps: z.number().min(0).nullable(),
  weatherUpdatedAt: z.string().datetime().nullable(),
});
export type VehicleSnapshot = z.infer<typeof VehicleSnapshotSchema>;
