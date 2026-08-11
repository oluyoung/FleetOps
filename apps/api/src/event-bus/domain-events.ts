import type { CanonicalTelemetryEvent } from "@repo/contracts";

export type TelemetryReceivedEvent = {
  type: "telemetry.received";
  event: CanonicalTelemetryEvent;
};

export type DomainEvent = TelemetryReceivedEvent;
