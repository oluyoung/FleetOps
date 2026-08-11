import { Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Per ADR-012: FleetOps' own Registry rather than prom-client's global
 * default — keeps `/metrics` scoped to exactly the signals this app defines,
 * with no `collectDefaultMetrics()` noise the ADR doesn't ask for.
 */
export const metricsRegistry = new Registry();

const PROVIDER_LABEL = ["provider"] as const;

export const telemetryEventsReceivedTotal = new Counter({
  name: "telemetry_events_received_total",
  help: "Canonical telemetry events accepted from a provider and published onto the event bus.",
  labelNames: PROVIDER_LABEL,
  registers: [metricsRegistry],
});

export const telemetryEventsRejectedTotal = new Counter({
  name: "telemetry_events_rejected_total",
  help: "Raw provider payloads rejected before becoming a canonical event.",
  labelNames: PROVIDER_LABEL,
  registers: [metricsRegistry],
});

export const telemetryIngestionLagMs = new Histogram({
  name: "telemetry_ingestion_lag_ms",
  help: "Milliseconds between a telemetry event's occurredAt and receivedAt.",
  labelNames: PROVIDER_LABEL,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000],
  registers: [metricsRegistry],
});

export const providerErrorsTotal = new Counter({
  name: "provider_errors_total",
  help: "Failed provider polls/connections.",
  labelNames: PROVIDER_LABEL,
  registers: [metricsRegistry],
});

export const providerLastSuccessTimestamp = new Gauge({
  name: "provider_last_success_timestamp",
  help: "Unix timestamp (seconds) of the last successful provider poll.",
  labelNames: PROVIDER_LABEL,
  registers: [metricsRegistry],
});

export const websocketConnectionsActive = new Gauge({
  name: "websocket_connections_active",
  help: "Currently open WebSocket connections.",
  registers: [metricsRegistry],
});

export const websocketReconnectTotal = new Counter({
  name: "websocket_reconnect_total",
  help: "WebSocket connections opened by a client that declared itself reconnecting.",
  registers: [metricsRegistry],
});

export const realtimeUpdatesPublishedTotal = new Counter({
  name: "realtime_updates_published_total",
  help: "Realtime updates delivered to a WebSocket client.",
  registers: [metricsRegistry],
});

export const realtimeUpdatesCoalescedTotal = new Counter({
  name: "realtime_updates_coalesced_total",
  help: "Realtime updates coalesced into a later update instead of being delivered individually.",
  registers: [metricsRegistry],
});

export const realtimeDeliveryErrorsTotal = new Counter({
  name: "realtime_delivery_errors_total",
  help: "Errors sending a realtime update to a WebSocket client.",
  registers: [metricsRegistry],
});
