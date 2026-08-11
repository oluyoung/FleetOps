import { z } from "zod";
import { TelemetrySourceSchema } from "./telemetry.js";

export const ProviderHealthStatusSchema = z.enum(["HEALTHY", "DEGRADED"]);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

/**
 * Per ADR-012/Step 18: a provider's health is derived from the same metrics
 * exposed on `/metrics`, not tracked as separate state — `GET
 * /providers/health` is just a read of `provider_last_success_timestamp` +
 * `provider_errors_total` + `telemetry_ingestion_lag_ms`, summarised.
 */
export const ProviderHealthSchema = z.object({
  provider: TelemetrySourceSchema,
  status: ProviderHealthStatusSchema,
  lastSuccessAt: z.string().datetime().nullable(),
  msSinceLastSuccess: z.number().nullable(),
  errorsTotal: z.number(),
  eventsReceivedTotal: z.number(),
  avgIngestionLagMs: z.number().nullable(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;
