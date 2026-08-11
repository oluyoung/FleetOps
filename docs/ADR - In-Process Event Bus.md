# ADR: In-Process Event Bus

## Status

Accepted

## Context

Once telemetry is normalised, multiple parts of the application may react to the same event:

* vehicle state;
* mission state;
* alerts;
* persistence;
* realtime delivery.

Direct service-to-service calls would create unnecessary coupling.

## Decision

Use an `EventBus` interface with an in-memory implementation for the MVP.

```ts
interface EventBus {
  publish(event: DomainEvent): Promise<void>;

  subscribe(
    type: DomainEvent["type"],
    handler: (event: DomainEvent) => Promise<void>
  ): void;
}
```

Example:

```text
CanonicalTelemetryEvent
        ↓
     EventBus
   ↙     ↓      ↘
Vehicle Alerts Realtime
```

## Why

This preserves event-driven boundaries without introducing Kafka, NATS or Redis before the system needs distributed messaging.

## Alternatives

**Direct service calls** — simpler initially but couples producers to consumers.

**Kafka/NATS** — useful at larger scale but unnecessary for a single-process MVP.

## Trade-offs

We do not get:

* durable replay;
* cross-process delivery;
* broker-managed retries;
* independent consumer scaling.
