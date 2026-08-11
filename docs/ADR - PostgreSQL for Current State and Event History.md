# ADR: PostgreSQL for Current State and Event History

## Status

Accepted

## Context

FleetOps needs to support two main data patterns:

1. Fast reads of current operational state.
2. Historical investigation of meaningful events.

For example:

```text
Current:
Where is vehicle 17 now?

Historical:
Why did vehicle 17 go offline?
```

The MVP does not need full event sourcing or indefinite storage of every raw telemetry sample.

## Decision

Use PostgreSQL as the primary operational datastore.

Store:

```text
vehicles
missions
alerts
operator_commands
vehicle_events
```

`vehicles`, `missions` and `alerts` represent current operational state.

`vehicle_events` stores meaningful append-only domain events such as:

```text
MISSION_STARTED
MISSION_PAUSED
VEHICLE_OFFLINE
LOW_BATTERY_ALERT
```

High-frequency raw telemetry updates are used to maintain current state but are not retained indefinitely.

## Why

PostgreSQL provides:

* strong transactions;
* relational integrity;
* mature indexing;
* straightforward operational queries;
* one datastore for the MVP.

## Alternatives

**Full event sourcing** — unnecessary complexity for current requirements.

**MongoDB** — flexible, but the domain has strong relational constraints.

**Time-series database** — useful for long-term raw telemetry, but not required for the MVP.

## Trade-offs

Current state and event history duplicate some information.

If raw telemetry retention becomes important, PostgreSQL may no longer be the ideal sole store.

## Revisit When

Consider additional storage when:

* raw telemetry retention becomes a product requirement;
* event volume affects operational queries;
* historical replay or analytics becomes a first-class feature.
