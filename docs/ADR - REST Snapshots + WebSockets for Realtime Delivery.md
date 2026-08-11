# ADR: REST Snapshots + WebSockets for Realtime Delivery

## Status
Accepted

## Context

FleetOps needs both:

- reliable access to current operational state;
- low-latency updates as vehicles, missions and alerts change.

Using WebSockets as the only delivery mechanism would make initial loading and recovery after disconnect unnecessarily complex.

Polling alone would be simpler, but inefficient for a realtime operational console.

## Decision

Use **REST for authoritative state snapshots** and **WebSockets for incremental realtime updates**.

```text
PostgreSQL
    │
    ├── REST ──────→ Initial / recovery snapshot
    │
    └── Event Bus
          ↓
      WebSocket ───→ Live deltas
```

Client flow:

```text
GET /fleet
    ↓
Render snapshot
    ↓
Connect WebSocket
    ↓
Subscribe
    ↓
Apply live updates
```

REST remains authoritative.

WebSockets are a delivery optimisation rather than the system of record.

## Reconnection

If the realtime connection is lost:

```text
Disconnect
    ↓
Reconnect with backoff
    ↓
Refetch REST snapshot
    ↓
Resume WebSocket updates
```

The MVP will not implement durable WebSocket event replay.

## Subscriptions

Clients subscribe only to relevant scopes:

```text
fleet:{fleetId}
vehicle:{vehicleId}
mission:{missionId}
```

This prevents every connected client from receiving the entire telemetry stream.

## Client State

REST and WebSocket updates feed the same frontend server-state cache.

```text
REST snapshot ───────┐
                     ▼
                 Client Cache
                     ▲
WebSocket delta ─────┘
```

This avoids maintaining separate "REST state" and "realtime state" in the UI.

## Ordering

Entity-level sequence numbers are used where ordering matters.

A client that has applied sequence `42` should reject an older update such as `41`.

Perfect global ordering across the fleet is not required.

## Why

This gives us:

- straightforward initial loading;
- low-latency operational updates;
- simple recovery after disconnect;
- a clear authoritative data source;
- room for future bidirectional realtime features.

## Alternatives

**Polling only** — simpler, but introduces latency and unnecessary repeated requests.

**SSE** — good for one-way server streaming, but WebSockets give us more flexibility for interactive operational features.

**WebSockets only** — rejected because initial state and reconnect recovery become more complicated.

## Trade-offs

We have two delivery mechanisms to maintain.

WebSocket delivery is not guaranteed, but correctness does not depend on it because clients can recover from authoritative REST state.

## Revisit

Revisit if:

- clients require guaranteed event replay;
- event history itself becomes a product feature;
- connection scale requires a dedicated realtime infrastructure layer;
- multi-region delivery changes the consistency model.