import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { buildApp } from "./app.js";
import { InMemoryEventBus } from "./event-bus/in-memory-event-bus.js";
import type { DomainEvent } from "./event-bus/domain-events.js";

function fakePool(rows: unknown[] = []): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pool;
}

describe("GET /health", () => {
  it("returns ok when the database responds", async () => {
    const app = buildApp({
      db: fakePool(),
      eventBus: new InMemoryEventBus<DomainEvent>(),
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /vehicles", () => {
  it("returns the current vehicle snapshots", async () => {
    const row = {
      id: "opensky-abc123",
      latitude: 51.5,
      longitude: -0.12,
      altitude_meters: 1000,
      speed_mps: 200,
      heading_degrees: 90,
      battery_percent: null,
      connectivity: null,
      last_seen_source: "opensky",
      last_updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };
    const app = buildApp({
      db: fakePool([row]),
      eventBus: new InMemoryEventBus<DomainEvent>(),
    });
    const response = await app.inject({ method: "GET", url: "/vehicles" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: "opensky-abc123",
        latitude: 51.5,
        longitude: -0.12,
        altitudeMeters: 1000,
        speedMps: 200,
        headingDegrees: 90,
        batteryPercent: null,
        connectivity: null,
        lastSeenSource: "opensky",
        lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("GET /vehicles/:id", () => {
  it("returns 404 when the vehicle does not exist", async () => {
    const app = buildApp({
      db: fakePool([]),
      eventBus: new InMemoryEventBus<DomainEvent>(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/vehicles/does-not-exist",
    });
    expect(response.statusCode).toBe(404);
  });
});
