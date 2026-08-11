import { TelemetrySourceSchema, type ProviderHealth, type TelemetrySource } from "@repo/contracts";
import {
  providerErrorsTotal,
  providerLastSuccessTimestamp,
  telemetryEventsReceivedTotal,
  telemetryIngestionLagMs,
} from "./metrics.js";

// A provider that has never reported a poll, or hasn't in this many
// multiples of its own poll interval, is no longer trustworthy — floored so
// a fast poller (e.g. MQTT's 1s drain) doesn't flap DEGRADED on one slow tick.
const STALE_MULTIPLIER = 3;
const MIN_STALE_AFTER_MS = 30_000;

// Ingestion lag beyond this is DEGRADED regardless of staleness — a provider
// can be "succeeding" on schedule while delivering data that's already old.
const MAX_AVG_INGESTION_LAG_MS = 30_000;

// A handful of errors during startup/backoff shouldn't flip status; a
// persistently high error *ratio* against successfully received events
// should. provider_errors_total/telemetry_events_received_total are both
// cumulative counters, so this is a lifetime ratio, not a recent rate — good
// enough for a coarse HEALTHY/DEGRADED read (Grafana's rate() panels are the
// place for trend detail, per ADR-012).
const MIN_ERROR_SAMPLES = 3;
const MAX_ERROR_RATIO = 0.5;

async function labelValue(
  metric: { get(): Promise<{ values: { value: number; labels: Record<string, unknown> }[] }> },
  provider: string,
): Promise<number | undefined> {
  const { values } = await metric.get();
  return values.find((v) => v.labels.provider === provider)?.value;
}

async function histogramAverage(
  provider: string,
): Promise<number | null> {
  const { values } = await telemetryIngestionLagMs.get();
  const sum = values.find(
    (v) => v.labels.provider === provider && v.metricName?.endsWith("_sum"),
  )?.value;
  const count = values.find(
    (v) => v.labels.provider === provider && v.metricName?.endsWith("_count"),
  )?.value;
  return sum !== undefined && count !== undefined && count > 0
    ? sum / count
    : null;
}

export async function deriveProviderHealth(
  pollIntervalsMs: Partial<Record<TelemetrySource, number>>,
  now: number = Date.now(),
): Promise<ProviderHealth[]> {
  return Promise.all(
    TelemetrySourceSchema.options.map(async (provider) => {
      const lastSuccessSec = await labelValue(providerLastSuccessTimestamp, provider);
      const errorsTotal = (await labelValue(providerErrorsTotal, provider)) ?? 0;
      const eventsReceivedTotal =
        (await labelValue(telemetryEventsReceivedTotal, provider)) ?? 0;
      const avgIngestionLagMs = await histogramAverage(provider);

      const msSinceLastSuccess =
        lastSuccessSec === undefined ? null : now - lastSuccessSec * 1000;

      const staleAfterMs = Math.max(
        (pollIntervalsMs[provider] ?? MIN_STALE_AFTER_MS) * STALE_MULTIPLIER,
        MIN_STALE_AFTER_MS,
      );

      const errorRatio =
        errorsTotal + eventsReceivedTotal > 0
          ? errorsTotal / (errorsTotal + eventsReceivedTotal)
          : 0;

      const isDegraded =
        msSinceLastSuccess === null ||
        msSinceLastSuccess > staleAfterMs ||
        (avgIngestionLagMs !== null && avgIngestionLagMs > MAX_AVG_INGESTION_LAG_MS) ||
        (errorsTotal >= MIN_ERROR_SAMPLES && errorRatio > MAX_ERROR_RATIO);

      return {
        provider,
        status: isDegraded ? "DEGRADED" : "HEALTHY",
        lastSuccessAt:
          lastSuccessSec === undefined
            ? null
            : new Date(lastSuccessSec * 1000).toISOString(),
        msSinceLastSuccess,
        errorsTotal,
        eventsReceivedTotal,
        avgIngestionLagMs,
      } satisfies ProviderHealth;
    }),
  );
}
