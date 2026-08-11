import { describe, expect, it } from "vitest";
import { CanonicalTelemetryEventSchema } from "./telemetry.js";

describe("CanonicalTelemetryEventSchema", () => {
  it("accepts a well-formed OpenSky-derived event", () => {
    const result = CanonicalTelemetryEventSchema.safeParse({
      eventId: "8b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b",
      vehicleId: "vehicle-001",
      source: "opensky",
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      telemetry: {
        latitude: 51.5,
        longitude: -0.12,
        speedMps: 12.3,
        headingDegrees: 270,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range latitude", () => {
    const result = CanonicalTelemetryEventSchema.safeParse({
      eventId: "8b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b",
      vehicleId: "vehicle-001",
      source: "opensky",
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      telemetry: { latitude: 200 },
    });
    expect(result.success).toBe(false);
  });
});
