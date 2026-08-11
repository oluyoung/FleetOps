import type { TelemetrySource } from "@repo/contracts";

/**
 * Per-provider error counts, kept in-memory ahead of Milestone 3 (ADR-012)
 * wiring this into `provider_errors_total` on the /metrics endpoint. Counts
 * every failed poll regardless of provider, so failure isolation between
 * providers (RFC-001) is visible per-source once exposed.
 */
const errorCounts = new Map<TelemetrySource, number>();

export function recordProviderError(source: TelemetrySource): void {
  errorCounts.set(source, (errorCounts.get(source) ?? 0) + 1);
}

export function getProviderErrorCounts(): ReadonlyMap<TelemetrySource, number> {
  return errorCounts;
}
