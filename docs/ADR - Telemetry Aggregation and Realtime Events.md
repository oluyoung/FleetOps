# ADR: Telemetry Aggregation and Realtime Events

## Status
Accepted

## Context

FleetOps may ingest telemetry more frequently than a human operator needs to see it.

For example, a vehicle could generate:

```text
10 telemetry events/sec
```

while the dashboard may only need:

```text
1–2 visual updates/sec
```

Forwarding every incoming telemetry event directly to every browser would create unnecessary:

- network traffic;
- WebSocket traffic;
- React renders;
- map updates;
- client processing.

However, reducing telemetry before domain processing could hide important operational events.

## Decision

Process all accepted telemetry through the domain first, then apply aggregation at the realtime delivery boundary.

```text
Telemetry
   ↓
Validation
   ↓
Domain Processing
   ↓
State / Alerts
   ↓
Realtime Delivery Policy
   │
   ├── Critical event ─────→ Immediate
   │
   └── Telemetry ──────────→ Aggregate
                                  ↓
                              WebSocket
```

## Replaceable Telemetry

High-frequency values such as:

```text
position
speed
heading
temperature
```

may be coalesced so the client receives the most recent value within a short delivery window.

For example:

```text
Incoming:

position A
position B
position C
position D

        ↓

Realtime window

        ↓

Client receives:

position D
```

The operator needs the latest position, not necessarily every intermediate render.

## Critical Events

Operationally significant events bypass aggregation.

Examples:

```text
VEHICLE_OFFLINE
VEHICLE_FAULTED
MISSION_FAILED
CRITICAL_ALERT
```

These are delivered immediately.

The key distinction is:

> Telemetry describes changing values; domain events describe something operationally meaningful.

## Why Aggregation Happens After Domain Processing

Before domain processing, we could lose important facts like crossed thresholds. This way only the UI telemetry stream is reduced.

## Slow Clients

The server must not maintain an unlimited queue for a client that cannot consume updates quickly enough.

For replaceable telemetry:

```text
old position
old position
old position
latest position
```

the older queued values may be discarded.

Critical domain events are not treated as replaceable.

Persistently unhealthy connections may be disconnected and recover through the REST snapshot flow defined in ADR - REST Snapshots + WebSockets for Realtime Delivery.

## Initial Policy

For the MVP, use a small configurable aggregation window rather than building a sophisticated adaptive algorithm.

For example:

```text
TELEMETRY_PUSH_INTERVAL_MS=500
```

This would cap replaceable telemetry at approximately two UI updates per second per subscription.

The exact value should be tuned from observed behaviour rather than treated as a domain constant.

## Alternatives

**Forward every event** — simplest, but unnecessarily couples ingestion frequency to UI delivery frequency.

**Throttle before domain processing** — rejected because meaningful state transitions could be missed.

**Kafka-style stream processing** — unnecessary for the expected MVP scale.

## Trade-offs

The UI does not display every telemetry sample.

That is intentional: FleetOps prioritises current operational visibility over lossless visualisation of raw telemetry.

If raw telemetry later needs to be replayed or analysed, that should be handled by a separate persistence/analytics path rather than the browser delivery channel.

## Revisit

Revisit if:

- telemetry frequency increases substantially;
- fleet size makes fixed-window aggregation inefficient;
- different telemetry types require different delivery guarantees;
- clients require high-resolution historical playback;
- adaptive sampling or priority-based delivery becomes valuable.