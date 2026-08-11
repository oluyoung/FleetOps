import { describe, expect, it, vi } from "vitest";
import type { CanonicalTelemetryEvent, VehicleSnapshot } from "@repo/contracts";
import { InMemoryEventBus } from "../event-bus/in-memory-event-bus.js";
import type { DomainEvent } from "../event-bus/domain-events.js";
import type { VehicleRepository } from "./vehicle-repository.js";
import type { RealtimeGateway } from "../realtime/realtime-gateway.js";
import { registerVehicleStateSubscriber } from "./vehicle-state-subscriber.js";

function snapshot(overrides: Partial<VehicleSnapshot> = {}): VehicleSnapshot {
  return {
    id: "opensky-abc123",
    latitude: 51.5,
    longitude: -0.12,
    altitudeMeters: null,
    speedMps: null,
    headingDegrees: null,
    batteryPercent: null,
    connectivity: null,
    lastSeenSource: "opensky",
    lastUpdatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    ambientTemperatureC: null,
    windSpeedMps: null,
    weatherUpdatedAt: null,
    ...overrides,
  };
}

function telemetryEvent(
  overrides: Partial<CanonicalTelemetryEvent> = {},
): CanonicalTelemetryEvent {
  return {
    eventId: "8b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b",
    vehicleId: "opensky-abc123",
    source: "opensky",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    telemetry: { latitude: 51.5, longitude: -0.12 },
    ...overrides,
  };
}

describe("registerVehicleStateSubscriber", () => {
  it("routes primary telemetry through upsertFromTelemetry", async () => {
    const upsertFromTelemetry = vi.fn().mockResolvedValue(snapshot());
    const applyEnrichment = vi.fn();
    const repository = {
      upsertFromTelemetry,
      applyEnrichment,
    } as unknown as VehicleRepository;
    const gateway = { broadcast: vi.fn() } as unknown as RealtimeGateway;
    const bus = new InMemoryEventBus<DomainEvent>();
    registerVehicleStateSubscriber(bus, repository, gateway, "fleet:default");

    await bus.publish({ type: "telemetry.received", event: telemetryEvent() });

    expect(upsertFromTelemetry).toHaveBeenCalledOnce();
    expect(applyEnrichment).not.toHaveBeenCalled();
    expect(gateway.broadcast).toHaveBeenCalledOnce();
  });

  it("routes open-meteo events through applyEnrichment", async () => {
    const upsertFromTelemetry = vi.fn();
    const applyEnrichment = vi
      .fn()
      .mockResolvedValue(snapshot({ ambientTemperatureC: 12 }));
    const repository = {
      upsertFromTelemetry,
      applyEnrichment,
    } as unknown as VehicleRepository;
    const gateway = { broadcast: vi.fn() } as unknown as RealtimeGateway;
    const bus = new InMemoryEventBus<DomainEvent>();
    registerVehicleStateSubscriber(bus, repository, gateway, "fleet:default");

    await bus.publish({
      type: "telemetry.received",
      event: telemetryEvent({
        source: "open-meteo",
        telemetry: { ambientTemperatureC: 12 },
      }),
    });

    expect(applyEnrichment).toHaveBeenCalledOnce();
    expect(upsertFromTelemetry).not.toHaveBeenCalled();
    expect(gateway.broadcast).toHaveBeenCalledOnce();
  });

  it("does not broadcast when enrichment no-ops (vehicle not found / stale)", async () => {
    const repository = {
      upsertFromTelemetry: vi.fn(),
      applyEnrichment: vi.fn().mockResolvedValue(null),
    } as unknown as VehicleRepository;
    const gateway = { broadcast: vi.fn() } as unknown as RealtimeGateway;
    const bus = new InMemoryEventBus<DomainEvent>();
    registerVehicleStateSubscriber(bus, repository, gateway, "fleet:default");

    await bus.publish({
      type: "telemetry.received",
      event: telemetryEvent({ source: "open-meteo" }),
    });

    expect(gateway.broadcast).not.toHaveBeenCalled();
  });
});
