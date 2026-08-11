import { describe, expect, it, vi } from "vitest";
import type { VehicleSnapshot } from "@repo/contracts";
import {
  groupVehiclesByLocation,
  mapForecastToEvents,
  WeatherAdapter,
  type WeatherLocation,
} from "./open-meteo.js";

function vehicle(overrides: Partial<VehicleSnapshot> = {}): VehicleSnapshot {
  return {
    id: "opensky-abc123",
    latitude: 51.5072,
    longitude: -0.1275,
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

describe("groupVehiclesByLocation", () => {
  it("groups vehicles rounded to the same coordinates into one location", () => {
    const locations = groupVehiclesByLocation([
      vehicle({ id: "a", latitude: 51.50721, longitude: -0.12749 }),
      vehicle({ id: "b", latitude: 51.5069, longitude: -0.1271 }),
    ]);

    expect(locations).toHaveLength(1);
    expect(locations[0]?.vehicleIds.sort()).toEqual(["a", "b"]);
  });

  it("skips vehicles with no known position", () => {
    const locations = groupVehiclesByLocation([
      vehicle({ id: "a", latitude: null, longitude: null }),
    ]);

    expect(locations).toEqual([]);
  });

  it("keeps distinct locations separate", () => {
    const locations = groupVehiclesByLocation([
      vehicle({ id: "a", latitude: 51.5, longitude: -0.1 }),
      vehicle({ id: "b", latitude: 40.7, longitude: -74.0 }),
    ]);

    expect(locations).toHaveLength(2);
  });
});

describe("mapForecastToEvents", () => {
  const location: WeatherLocation = {
    latitude: 51.51,
    longitude: -0.13,
    vehicleIds: ["opensky-abc123", "opensky-def456"],
  };

  it("maps a forecast to one event per vehicle at that location", () => {
    const events = mapForecastToEvents(location, {
      latitude: 51.51,
      longitude: -0.13,
      current: {
        time: "2026-01-01T00:00",
        temperature_2m: 12.3,
        wind_speed_10m: 4.1,
      },
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.vehicleId).sort()).toEqual([
      "opensky-abc123",
      "opensky-def456",
    ]);
    expect(events[0]?.source).toBe("open-meteo");
    expect(events[0]?.occurredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(events[0]?.telemetry).toEqual({
      ambientTemperatureC: 12.3,
      windSpeedMps: 4.1,
    });
  });

  it("returns [] when the forecast has no current block", () => {
    expect(
      mapForecastToEvents(location, { latitude: 51.51, longitude: -0.13 }),
    ).toEqual([]);
  });

  it("returns [] when current carries neither enriched field", () => {
    expect(
      mapForecastToEvents(location, {
        latitude: 51.51,
        longitude: -0.13,
        current: { time: "2026-01-01T00:00" },
      }),
    ).toEqual([]);
  });
});

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("WeatherAdapter.poll", () => {
  it("returns [] and skips the HTTP call when no vehicle has a position", async () => {
    const fetchFn = fakeFetch({});
    const adapter = new WeatherAdapter(
      { findAll: async () => [vehicle({ latitude: null, longitude: null })] },
      fetchFn,
    );

    expect(await adapter.poll()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps a single-location response (Open-Meteo returns an object, not an array)", async () => {
    const fetchFn = fakeFetch({
      latitude: 51.51,
      longitude: -0.13,
      current: { time: "2026-01-01T00:00", temperature_2m: 10, wind_speed_10m: 3 },
    });
    const adapter = new WeatherAdapter(
      { findAll: async () => [vehicle()] },
      fetchFn,
    );

    const events = await adapter.poll();

    expect(events).toHaveLength(1);
    expect(events[0]?.vehicleId).toBe("opensky-abc123");
    expect(events[0]?.telemetry).toEqual({
      ambientTemperatureC: 10,
      windSpeedMps: 3,
    });
  });

  it("maps a multi-location response, zipping forecasts to locations by order", async () => {
    const fetchFn = fakeFetch([
      {
        latitude: 51.5,
        longitude: -0.1,
        current: { time: "2026-01-01T00:00", temperature_2m: 10, wind_speed_10m: 3 },
      },
      {
        latitude: 40.7,
        longitude: -74.0,
        current: { time: "2026-01-01T00:00", temperature_2m: 22, wind_speed_10m: 1 },
      },
    ]);
    const adapter = new WeatherAdapter(
      {
        findAll: async () => [
          vehicle({ id: "a", latitude: 51.5, longitude: -0.1 }),
          vehicle({ id: "b", latitude: 40.7, longitude: -74.0 }),
        ],
      },
      fetchFn,
    );

    const events = await adapter.poll();

    expect(events.find((e) => e.vehicleId === "a")?.telemetry).toEqual({
      ambientTemperatureC: 10,
      windSpeedMps: 3,
    });
    expect(events.find((e) => e.vehicleId === "b")?.telemetry).toEqual({
      ambientTemperatureC: 22,
      windSpeedMps: 1,
    });
  });

  it("throws when the HTTP request fails, without crashing the process", async () => {
    const adapter = new WeatherAdapter(
      { findAll: async () => [vehicle()] },
      fakeFetch({}, false),
    );

    await expect(adapter.poll()).rejects.toThrow("Open-Meteo request failed");
  });
});
