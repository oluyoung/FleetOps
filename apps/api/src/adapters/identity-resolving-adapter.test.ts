import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CanonicalTelemetryEvent } from "@repo/contracts";
import { IdentityResolvingAdapter } from "./identity-resolving-adapter.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { VehicleIdentityResolver } from "../vehicles/vehicle-identity-resolver.js";

function event(vehicleId: string): CanonicalTelemetryEvent {
  return {
    eventId: crypto.randomUUID(),
    vehicleId,
    source: "opensky",
    occurredAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    telemetry: { latitude: 0, longitude: 0 },
  };
}

class FakeResolver implements VehicleIdentityResolver {
  private readonly mapping = new Map<string, string>();
  calls: Array<{ source: string; providerRef: string }> = [];

  async resolve(source: string, providerRef: string): Promise<string> {
    this.calls.push({ source, providerRef });
    const key = `${source}:${providerRef}`;
    const existing = this.mapping.get(key);
    if (existing) return existing;
    const canonicalId = `veh-${this.mapping.size}`;
    this.mapping.set(key, canonicalId);
    return canonicalId;
  }
}

function fakeAdapter(events: CanonicalTelemetryEvent[]): ProviderAdapter {
  return {
    source: "opensky",
    poll: async () => events,
  };
}

describe("IdentityResolvingAdapter", () => {
  it("rewrites vehicleId to the resolver's canonical id", async () => {
    const resolver = new FakeResolver();
    const adapter = new IdentityResolvingAdapter(
      fakeAdapter([event("opensky-abc123")]),
      resolver,
    );

    const events = await adapter.poll();

    expect(events[0]?.vehicleId).toBe("veh-0");
  });

  it("resolves the same raw provider id to the same canonical id across polls", async () => {
    const resolver = new FakeResolver();
    const adapter = new IdentityResolvingAdapter(
      fakeAdapter([event("opensky-abc123")]),
      resolver,
    );

    const first = await adapter.poll();
    const second = await adapter.poll();

    expect(first[0]?.vehicleId).toBe(second[0]?.vehicleId);
  });

  it("exposes the inner adapter's source", () => {
    const adapter = new IdentityResolvingAdapter(
      fakeAdapter([]),
      new FakeResolver(),
    );
    expect(adapter.source).toBe("opensky");
  });

  it("preserves telemetry and only rewrites vehicleId", async () => {
    const resolver = new FakeResolver();
    const raw = event("opensky-abc123");
    raw.telemetry = { latitude: 51.5, longitude: -0.1, speedMps: 42 };
    const adapter = new IdentityResolvingAdapter(fakeAdapter([raw]), resolver);

    const events = await adapter.poll();

    expect(events[0]?.telemetry).toEqual(raw.telemetry);
    expect(events[0]?.eventId).toBe(raw.eventId);
  });
});
