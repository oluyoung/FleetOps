import { describe, expect, it, vi } from "vitest";
import { mapStateVectorToEvent, OpenSkyAdapter } from "./opensky.js";

// Real OpenSky state vector shape:
// [icao24, callsign, origin_country, time_position, last_contact,
//  longitude, latitude, baro_altitude, on_ground, velocity, true_track,
//  vertical_rate, sensors, geo_altitude, squawk, spi, position_source]
function stateVector(overrides: Record<number, unknown> = {}): unknown[] {
  const base: unknown[] = [
    "abc123",
    "TEST123 ",
    "United Kingdom",
    1_700_000_000,
    1_700_000_000,
    -0.1275,
    51.5072,
    11277.6,
    false,
    128.5,
    270,
    0,
    null,
    11582.4,
    "1000",
    false,
    0,
  ];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
}

describe("mapStateVectorToEvent", () => {
  it("maps a well-formed state vector to a canonical event", () => {
    const event = mapStateVectorToEvent(stateVector());

    expect(event).not.toBeNull();
    expect(event?.vehicleId).toBe("opensky-abc123");
    expect(event?.source).toBe("opensky");
    expect(event?.occurredAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(event?.telemetry).toMatchObject({
      latitude: 51.5072,
      longitude: -0.1275,
      altitudeMeters: 11277.6,
      speedMps: 128.5,
      headingDegrees: 270,
    });
  });

  it("falls back to last_contact when time_position is missing", () => {
    const event = mapStateVectorToEvent(
      stateVector({ 3: null, 4: 1_700_000_500 }),
    );

    expect(event?.occurredAt).toBe(
      new Date(1_700_000_500 * 1000).toISOString(),
    );
  });

  it("rejects a vector with no position fix", () => {
    const event = mapStateVectorToEvent(
      stateVector({ 5: null, 6: null }),
    );

    expect(event).toBeNull();
  });

  it("rejects a vector with no icao24", () => {
    const event = mapStateVectorToEvent(stateVector({ 0: null }));

    expect(event).toBeNull();
  });

  it("rejects a vector with no usable timestamp", () => {
    const event = mapStateVectorToEvent(
      stateVector({ 3: null, 4: null }),
    );

    expect(event).toBeNull();
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

describe("OpenSkyAdapter.poll", () => {
  it("returns canonical events for valid state vectors and skips malformed ones", async () => {
    const adapter = new OpenSkyAdapter(
      fakeFetch({
        time: 1_700_000_000,
        states: [stateVector(), stateVector({ 5: null, 6: null }), ["not", "enough", "fields"]],
      }),
    );

    const events = await adapter.poll();

    expect(events).toHaveLength(1);
    expect(events[0]?.vehicleId).toBe("opensky-abc123");
  });

  it("returns an empty array when states is null", async () => {
    const adapter = new OpenSkyAdapter(fakeFetch({ time: 1_700_000_000, states: null }));

    expect(await adapter.poll()).toEqual([]);
  });

  it("throws when the HTTP request fails, without crashing the process", async () => {
    const adapter = new OpenSkyAdapter(fakeFetch({}, false));

    await expect(adapter.poll()).rejects.toThrow("OpenSky request failed");
  });

  it("bounds the fleet to a fixed, deterministic set of vehicles", async () => {
    const states = ["ccc", "aaa", "bbb", "ddd"].map((icao24) =>
      stateVector({ 0: icao24 }),
    );
    const adapter = new OpenSkyAdapter(
      fakeFetch({ time: 1_700_000_000, states }),
      undefined,
      2,
    );

    const events = await adapter.poll();

    expect(events.map((e) => e.vehicleId).sort()).toEqual([
      "opensky-aaa",
      "opensky-bbb",
    ]);
  });

  it("keeps reporting the same fleet across polls even as the global feed changes", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          time: 1_700_000_000,
          states: ["aaa", "bbb", "ccc"].map((icao24) =>
            stateVector({ 0: icao24 }),
          ),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          time: 1_700_000_100,
          // "aaa" drops out, a new "zzz" appears
          states: ["bbb", "ccc", "zzz"].map((icao24) =>
            stateVector({ 0: icao24 }),
          ),
        }),
      }) as unknown as typeof fetch;
    const adapter = new OpenSkyAdapter(fetchFn, undefined, 2);

    const first = await adapter.poll();
    const second = await adapter.poll();

    expect(first.map((e) => e.vehicleId).sort()).toEqual([
      "opensky-aaa",
      "opensky-bbb",
    ]);
    // "aaa" is still the pinned fleet, so it's just absent this poll —
    // "zzz" never gets reported even though it's in the raw feed.
    expect(second.map((e) => e.vehicleId).sort()).toEqual(["opensky-bbb"]);
  });
});
