# ADR: Provider Adapters

## Status

Accepted

## Context

FleetOps consumes telemetry from providers with different schemas and transport mechanisms.

Provider-specific types should not leak into domain logic, persistence or the frontend.

## Decision

Use provider adapters to translate external data into canonical FleetOps telemetry contracts.

Examples:

```text
OpenSky → OpenSkyAdapter → CanonicalTelemetryEvent
Open-Meteo → WeatherAdapter → CanonicalTelemetryEvent
MQTT → IoTAdapter → CanonicalTelemetryEvent
```

Adapters own:

* schema validation;
* unit conversion;
* timestamp normalisation;
* provider-specific error handling;
* provider ID mapping.

Domain services only consume FleetOps contracts.

## Why

This keeps the core application independent of upstream providers and makes integrations easier to replace or extend.

## Alternatives

**Use provider DTOs directly** — rejected because it tightly couples the application to external schemas.

**Separate microservice per provider** — unnecessary for the MVP.

## Trade-offs

The adapter layer adds mapping code, but gives us stable domain contracts and cleaner boundaries.

## Revisit When

Revisit if provider integrations need independent scaling or become complex enough to justify separate services.
