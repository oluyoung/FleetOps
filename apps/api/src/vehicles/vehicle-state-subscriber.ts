import type { EventBus } from "../event-bus/event-bus.js";
import type { DomainEvent } from "../event-bus/domain-events.js";
import type { VehicleRepository } from "./vehicle-repository.js";
import type { RealtimeGateway } from "../realtime/realtime-gateway.js";

export function registerVehicleStateSubscriber(
  bus: EventBus<DomainEvent>,
  repository: VehicleRepository,
  realtimeGateway: RealtimeGateway,
  scope: string,
): void {
  bus.subscribe("telemetry.received", async (event) => {
    const snapshot = await repository.upsertFromTelemetry(event.event);
    if (!snapshot) return; // stale event: no state change to broadcast

    realtimeGateway.broadcast(scope, {
      type: "vehicle.updated",
      entityId: snapshot.id,
      occurredAt: event.event.occurredAt,
      payload: snapshot,
    });
  });
}
