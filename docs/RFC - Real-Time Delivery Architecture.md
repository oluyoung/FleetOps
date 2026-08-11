# RFC: Real-Time Delivery Architecture

## Status
Accepted

## Problem

FleetOps is an operational console where vehicle state, missions and alerts can change continuously.

Operators need to see important changes without manually refreshing or aggressively polling the backend.

At the same time, WebSocket connections are transient. A disconnected client may miss events, so the realtime channel should not become the source of truth.

The architecture needs to support:

- authoritative initial state;
- low-latency live updates;
- reconnect recovery;
- high-frequency telemetry;
- targeted subscriptions;
- consistent client state.

## Proposed Design

Use **REST for authoritative snapshots** and **WebSockets for incremental realtime updates**.

```text
              PostgreSQL
                  │
           ┌──────┴──────┐
           │             │
          REST       Domain Events
           │             │
           ▼             ▼
     Initial State   Event Bus
                         │
                         ▼
                  WebSocket Gateway
                         │
           ┌─────────────┴─────────────┐
           ▼                           ▼
      Fleet Client                Fleet Client
```

Client lifecycle:

```text
Open application
      ↓
GET /fleet
      ↓
Render authoritative snapshot
      ↓
Connect WebSocket
      ↓
Subscribe to relevant events
      ↓
Apply incremental updates
```

REST remains authoritative. WebSockets make that state feel live.

## Event Model

Realtime messages use a stable envelope rather than exposing internal event-bus objects directly.

```ts
type RealtimeEvent<T> = {
  eventId: string;
  type: string;
  entityId: string;
  occurredAt: string;
  sequence?: number;
  payload: T;
};
```

Example:

```json
{
  "eventId": "evt-123",
  "type": "VEHICLE_UPDATED",
  "entityId": "vehicle-17",
  "occurredAt": "2026-08-11T00:15:31Z",
  "sequence": 42,
  "payload": {
    "latitude": 51.47,
    "longitude": -0.45,
    "speedKph": 28.4
  }
}
```

The WebSocket contract is therefore independent of OpenSky, MQTT or other provider schemas.

## Snapshot + Delta

Clients do not reconstruct the entire application state from WebSocket history.

Instead:

```text
REST snapshot
     +
WebSocket deltas
     =
Current UI state
```

This keeps recovery simple and avoids requiring durable event replay for the MVP.

## Reconnection

When a WebSocket connection is lost:

```text
Disconnect
    ↓
Reconnect with backoff
    ↓
Refetch authoritative snapshot
    ↓
Resume realtime updates
```

The MVP deliberately prefers snapshot recovery over implementing a durable replay protocol.

This means a missed WebSocket event does not permanently corrupt client state.

## Subscription Granularity

Clients should only receive events relevant to their current view.

Initial subscription scopes:

```text
fleet:{fleetId}
vehicle:{vehicleId}
mission:{missionId}
```

For example, the fleet dashboard may subscribe to fleet-level summaries while a vehicle detail page receives more granular telemetry.

This avoids broadcasting every event to every connected client.

## High-Frequency Telemetry

Incoming telemetry frequency and useful UI update frequency are different concerns.

For example:

```text
Telemetry ingestion
10 updates/sec
      ↓
Domain processing
10 updates/sec
      ↓
Realtime aggregation
      ↓
UI
2 updates/sec
```

Operationally significant events such as:

```text
VEHICLE_OFFLINE
VEHICLE_FAULTED
MISSION_FAILED
CRITICAL_ALERT
```

bypass aggregation and are delivered immediately.

Aggregation therefore happens **after domain processing**, so important transitions are not lost simply because the UI does not need every telemetry sample.

The exact aggregation policy is defined separately in ADR-010.

## Client State Synchronisation

The frontend will maintain server state using a query/cache layer.

REST populates the cache:

```text
GET /vehicles/17
        ↓
Vehicle cache
```

WebSocket events update or invalidate the same cached state:

```text
VEHICLE_UPDATED
        ↓
Vehicle cache
        ↓
React re-render
```

Realtime state should not become a second independent source of frontend truth.

## Event Ordering

Where available, realtime events include an entity-level sequence number.

Clients ignore events older than the latest applied sequence.

```text
Current sequence: 42

Receive 43 → apply

Receive 41 → ignore
```

Perfect global ordering across the entire fleet is not required.

## Backpressure

Slow clients must not be allowed to create unbounded server-side queues.

The realtime layer may:

- coalesce replaceable telemetry updates;
- discard superseded position updates;
- disconnect persistently slow consumers.

Critical domain events are not treated as replaceable telemetry.

## Alternatives Considered

**REST polling** — simple and resilient, but inefficient for frequently changing operational data and introduces avoidable latency.

**Server-Sent Events** — suitable for server-to-client streaming, but WebSockets provide more flexibility for future interactive operational features.

**WebSockets only** — rejected because reconnect recovery and authoritative initial state become unnecessarily complicated.

## Trade-offs

WebSockets introduce connection lifecycle, subscription and backpressure complexity.

Using REST alongside them duplicates some delivery paths, but gives us a simple recovery model and keeps PostgreSQL-backed API state authoritative.

The MVP also does not guarantee delivery of every realtime event. Correctness comes from authoritative snapshots rather than WebSocket durability.

## Success Criteria

The design is successful when:

- the UI can load complete state without WebSockets;
- vehicle, mission and alert changes appear without manual refresh;
- reconnecting clients recover through a fresh snapshot;
- stale events cannot overwrite newer client state;
- high-frequency telemetry does not overwhelm the browser;
- critical operational events are delivered immediately;
- clients receive only events relevant to their subscriptions.