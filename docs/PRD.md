# FleetOps Console — Product Requirements

**Version:** 1.0
**Author:** Kanyinsola Olugbake
**Status:** Accepted — MVP

## Overview

FleetOps Console is a realtime operational dashboard for ingesting, normalising and visualising live telemetry from multiple external sources.

The project focuses on a problem common to connected and autonomous systems: **how to turn heterogeneous, continuously changing telemetry into a reliable and responsive operational view.**

It does not control vehicles or simulate autonomous driving. The focus is the software and data platform around realtime fleet operations.

## What We're Building

The MVP ingests three types of data:

* **OpenSky** — live moving-object position, speed and heading data.
* **Open-Meteo** — environmental enrichment based on location.
* **MQTT** — streaming IoT-style vehicle health telemetry.

These sources have different schemas, transports and update frequencies.

FleetOps converts them into a common telemetry model, maintains current state and streams relevant changes to a Next.js operational dashboard.

```text
OpenSky     Open-Meteo     MQTT
    \           |           /
         Provider Adapters
                ↓
       Canonical Telemetry
                ↓
          Event Processing
                ↓
           PostgreSQL
                ↓
        REST + WebSockets
                ↓
      Next.js Fleet Console
```

## Operator Experience

An operator should be able to open FleetOps and quickly understand:

* what vehicles are currently visible;
* where they are;
* their latest telemetry;
* whether their data is current or stale;
* relevant health/environmental information;
* whether upstream telemetry providers are healthy.

Vehicle positions and telemetry update without requiring a browser refresh.

Selecting a vehicle provides a more detailed view of its current telemetry and recent meaningful events.

## MVP Requirements

The MVP must demonstrate:

### Live telemetry

Real OpenSky data is ingested and displayed continuously.

MQTT provides a separate streaming ingestion path for IoT-style health telemetry.

### Provider independence

External provider schemas stop at the ingestion boundary.

The rest of FleetOps works against a canonical telemetry contract.

### Realtime delivery

The UI loads authoritative state through REST and receives incremental changes through WebSockets.

Disconnected clients recover by reconnecting and refreshing current state.

### High-frequency data handling

The backend may process telemetry more frequently than the browser needs to render it.

Replaceable updates such as position and speed can therefore be coalesced before delivery to the UI.

### Failure isolation

Failure of weather enrichment or another provider must not stop the primary telemetry pipeline.

### Observability

The demo exposes enough operational information to understand:

* telemetry throughput;
* ingestion lag;
* provider failures;
* WebSocket connections;
* rejected events;
* coalesced realtime updates.

A small Grafana dashboard will make these characteristics visible during the demo.

## Non-Goals

The MVP will not:

* control physical vehicles;
* provide mission control;
* simulate autonomous driving;
* perform path planning or robotics processing;
* implement AI features;
* introduce distributed microservices or Kafka;
* retain every raw telemetry sample indefinitely;
* attempt to model Oxa's actual systems.

The goal is to demonstrate engineering principles relevant to realtime operational platforms, not reproduce an autonomous vehicle platform.

## Success Criteria

The MVP is successful when:

* real external telemetry is visible in the dashboard;
* multiple data sources can enter through the same ingestion architecture;
* provider-specific models do not leak into the application;
* the dashboard updates continuously without refresh;
* reconnecting clients recover correctly;
* high-frequency telemetry does not overwhelm the UI;
* one provider can degrade without stopping the system;
* the realtime pipeline can be inspected through logs and metrics;
* the application can be demonstrated from a public URL.

## Technical Decisions

The PRD intentionally avoids detailed implementation decisions.

Those are documented separately:

**RFCs**

* RFC — Telemetry Ingestion and Normalisation
* RFC — Real-Time Delivery Architecture

**ADRs**

* ADR — REST Snapshots + WebSockets
* ADR — PostgreSQL State + Event History
* ADR — Provider Adapters
* ADR — In-Process Event Bus
* ADR — Telemetry Aggregation and Backpressure
* ADR — Long-Running Containerised Backend
* ADR — Structured Logging and Metrics

These documents explain the major architectural choices, alternatives and trade-offs behind the implementation.
