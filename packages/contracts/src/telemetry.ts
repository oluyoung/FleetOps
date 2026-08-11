import { z } from "zod";

export const TelemetrySourceSchema = z.enum(["opensky", "open-meteo", "mqtt"]);
export type TelemetrySource = z.infer<typeof TelemetrySourceSchema>;

/**
 * The universal shape every provider adapter normalises into (RFC-001).
 * Adapters own validation/unit conversion/id mapping before an event
 * reaches the domain layer — nothing downstream should see raw provider payloads.
 */
export const CanonicalTelemetryEventSchema = z.object({
  eventId: z.string().uuid(),
  vehicleId: z.string().min(1),
  source: TelemetrySourceSchema,
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  telemetry: z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    altitudeMeters: z.number().optional(),
    speedMps: z.number().min(0).optional(),
    headingDegrees: z.number().min(0).max(360).optional(),
    batteryPercent: z.number().min(0).max(100).optional(),
    motorTemperatureC: z.number().optional(),
    connectivity: z.enum(["good", "degraded", "offline"]).optional(),
    ambientTemperatureC: z.number().optional(),
    windSpeedMps: z.number().min(0).optional(),
  }),
});
export type CanonicalTelemetryEvent = z.infer<
  typeof CanonicalTelemetryEventSchema
>;
