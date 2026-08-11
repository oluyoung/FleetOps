import type { EventBus } from "../event-bus/event-bus.js";
import type { DomainEvent } from "../event-bus/domain-events.js";
import type { VehicleRepository } from "./vehicle-repository.js";

export function registerVehicleStateSubscriber(
  bus: EventBus<DomainEvent>,
  repository: VehicleRepository,
): void {
  bus.subscribe("telemetry.received", async (event) => {
    await repository.upsertFromTelemetry(event.event);
  });
}
