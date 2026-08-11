import type { CanonicalTelemetryEvent, TelemetrySource } from "@repo/contracts";

/**
 * Per ADR-005: adapters own schema validation, unit conversion, timestamp
 * normalisation and provider ID mapping. Everything downstream only ever
 * sees CanonicalTelemetryEvent — never a raw provider payload.
 */
export interface ProviderAdapter {
  readonly source: TelemetrySource;
  poll(): Promise<CanonicalTelemetryEvent[]>;
}
