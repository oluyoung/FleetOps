# ADR: Structured Logging and Metrics

## Status
Accepted

## Context

FleetOps is a realtime data system where many important failures will not appear as obvious HTTP errors.

We need to answer operational questions such as:

- Is OpenSky still producing telemetry?
- Is the MQTT connection healthy?
- How far behind realtime is ingestion?
- Are malformed events being rejected?
- How many WebSocket clients are connected?
- Are telemetry updates being coalesced because of backpressure?
- Is one provider degraded while the rest of the system remains healthy?

We want this visibility without building a custom logging or monitoring platform.

## Decision

Instrument FleetOps using:

```text
Pino
  → structured application logs

prom-client
  → application metrics

Prometheus
  → metric collection and storage

Grafana
  → dashboards and visualisation
```

Locally these services will run through Docker Compose alongside the application where practical.

```text
Telemetry Providers
        ↓
     Fastify
     ↙     ↘
  Pino    prom-client
    ↓         ↓
JSON logs  /metrics
              ↓
         Prometheus
              ↓
           Grafana
```

FleetOps owns **what is instrumented and what constitutes a useful operational signal**.

Existing observability tooling owns collection, storage, querying and visualisation.

## Structured Logging

Fastify's Pino integration will be used for structured JSON logs.

Example:

```ts
request.log.info(
  {
    provider: "opensky",
    vehicleId: "vehicle-17",
    eventId,
    ingestionLagMs: 143,
  },
  "telemetry processed",
);
```

Useful context should include where available:

```text
provider
vehicleId
eventId
occurredAt
receivedAt
ingestionLagMs
connectionId
requestId
```

We should avoid logging every telemetry event at `info` level when ingestion frequency increases. High-volume diagnostic information can use debug-level logging.

## Metrics

`prom-client` will expose Prometheus-compatible metrics from the Fastify application through:

```http
GET /metrics
```

Initial metrics:

```text
telemetry_events_received_total
telemetry_events_rejected_total
telemetry_ingestion_lag_ms

provider_errors_total
provider_last_success_timestamp

websocket_connections_active
websocket_reconnect_total

realtime_updates_published_total
realtime_updates_coalesced_total
realtime_delivery_errors_total
```

Metrics will use low-cardinality labels such as:

```text
provider="opensky"
provider="mqtt"
provider="weather"
```

IDs such as `vehicleId`, `eventId` and `connectionId` belong in logs rather than Prometheus labels to avoid high-cardinality metrics.

## Provider Health

Provider health can be derived from metrics such as:

```text
provider_last_success_timestamp
provider_errors_total
telemetry_ingestion_lag_ms
```

This allows us to distinguish:

```text
OpenSky     HEALTHY
MQTT        HEALTHY
Open-Meteo  DEGRADED
```

without treating one provider failure as total application failure.

## Grafana

Grafana will provide a small operational dashboard for the demo.

The initial dashboard should show:

```text
Telemetry events / second
Ingestion latency
Rejected events
Provider errors
Active WebSocket connections
Realtime updates published
Realtime updates coalesced
Provider health
```

This gives us visibility across the complete path:

```text
Provider
   ↓
Ingestion
   ↓
Processing
   ↓
Realtime delivery
   ↓
Client
```

## Why

Pino fits naturally with Fastify and provides structured logging without introducing a custom abstraction unnecessarily.

`prom-client` provides lightweight application instrumentation using the Prometheus metrics model.

Prometheus provides a widely understood metrics collection model, while Grafana gives us useful visualisation without building a monitoring UI ourselves.

Together they demonstrate production-oriented observability while remaining small enough for the demo.

## Alternatives

**Custom monitoring system** — rejected because observability infrastructure is not the problem FleetOps is trying to solve.

**Logs only** — insufficient for understanding trends such as ingestion rate, latency and active connection counts.

**Full distributed tracing stack** — unnecessary while the MVP runs primarily as a single backend process.

## Trade-offs

Running Prometheus and Grafana adds local infrastructure and Docker containers.

Instrumentation also adds some application code and runtime overhead.

For the MVP, we will therefore instrument only signals that help us understand the realtime pipeline rather than attempting comprehensive production monitoring.

## Revisit When

Expand the observability architecture when:

- the backend becomes distributed;
- Kafka/NATS or multiple ingestion workers are introduced;
- end-to-end distributed tracing becomes valuable;
- production SLOs and alerting requirements are defined;
- longer-term log aggregation becomes necessary.