import { describe, expect, it, vi, afterEach } from "vitest";
import type { Pool } from "pg";
import WebSocket from "ws";
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
    const { app } = await buildApp({
      db: fakePool(),
      eventBus: new InMemoryEventBus<DomainEvent>(),
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /metrics", () => {
  it("exposes the Prometheus metric set from ADR-012", async () => {
    const { app } = await buildApp({
      db: fakePool(),
      eventBus: new InMemoryEventBus<DomainEvent>(),
    });
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    for (const metric of [
      "telemetry_events_received_total",
      "telemetry_events_rejected_total",
      "telemetry_ingestion_lag_ms",
      "provider_errors_total",
      "provider_last_success_timestamp",
      "websocket_connections_active",
      "websocket_reconnect_total",
      "realtime_updates_published_total",
      "realtime_updates_coalesced_total",
      "realtime_delivery_errors_total",
    ]) {
      expect(response.body).toContain(metric);
    }
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
      ambient_temperature_c: null,
      wind_speed_mps: null,
      weather_updated_at: null,
    };
    const { app } = await buildApp({
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
        ambientTemperatureC: null,
        windSpeedMps: null,
        weatherUpdatedAt: null,
      },
    ]);
  });
});

describe("GET /vehicles/:id", () => {
  it("returns 404 when the vehicle does not exist", async () => {
    const { app } = await buildApp({
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

describe("GET /ws", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  it("broadcasts a vehicle.updated event when telemetry is upserted", async () => {
    const row = {
      id: "opensky-abc123",
      latitude: 51.5,
      longitude: -0.12,
      altitude_meters: null,
      speed_mps: 200,
      heading_degrees: 90,
      battery_percent: null,
      connectivity: null,
      last_seen_source: "opensky",
      last_updated_at: new Date("2026-01-01T00:00:00.000Z"),
      inserted: true,
    };
    const eventBus = new InMemoryEventBus<DomainEvent>();
    const { app } = await buildApp({ db: fakePool([row]), eventBus });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    closeServer = () => app.close();

    const ws = new WebSocket(`${address.replace("http", "ws")}/ws`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const received = new Promise((resolve) => {
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
    });

    await eventBus.publish({
      type: "telemetry.received",
      event: {
        eventId: "8b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b",
        vehicleId: "opensky-abc123",
        source: "opensky",
        occurredAt: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:01.000Z",
        telemetry: { latitude: 51.5, longitude: -0.12, speedMps: 200 },
      },
    });

    expect(await received).toMatchObject({
      type: "vehicle.updated",
      scope: "fleet:default",
      entityId: "opensky-abc123",
      sequence: 1,
    });
    ws.terminate();
  });
});
