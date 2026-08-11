import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadOpenSkyCredentials,
  mapStateVectorToEvent,
  OpenSkyAdapter,
} from "./opensky.js";

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

  it("fetches and attaches a bearer token when credentials are provided", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ access_token: "tok-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ time: 1_700_000_000, states: [stateVector()] }),
      }) as unknown as typeof fetch;

    const adapter = new OpenSkyAdapter(fetchFn, undefined, undefined, {
      clientId: "id",
      clientSecret: "secret",
    });

    await adapter.poll();

    const statesCall = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.at(1);
    expect(statesCall?.[1]).toMatchObject({
      headers: { Authorization: "Bearer tok-1" },
    });
  });

  it("reuses a cached token across polls instead of re-authenticating", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ access_token: "tok-1", expires_in: 3600 }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ time: 1_700_000_000, states: [] }),
      }) as unknown as typeof fetch;

    const adapter = new OpenSkyAdapter(fetchFn, undefined, undefined, {
      clientId: "id",
      clientSecret: "secret",
    });

    await adapter.poll();
    await adapter.poll();

    const tokenCalls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]) => url === "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("propagates a token request failure without crashing", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const adapter = new OpenSkyAdapter(fetchFn, undefined, undefined, {
      clientId: "id",
      clientSecret: "wrong",
    });

    await expect(adapter.poll()).rejects.toThrow("OpenSky token request failed");
  });

  it("re-authenticates once and retries after a 401, without failing the poll", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ access_token: "tok-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ access_token: "tok-2", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ time: 1_700_000_000, states: [stateVector()] }),
      }) as unknown as typeof fetch;

    const adapter = new OpenSkyAdapter(fetchFn, undefined, undefined, {
      clientId: "id",
      clientSecret: "secret",
    });

    const events = await adapter.poll();

    expect(events).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    const finalCall = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.at(3);
    expect(finalCall?.[1]).toMatchObject({
      headers: { Authorization: "Bearer tok-2" },
    });
  });
});

describe("loadOpenSkyCredentials", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("returns undefined when the credentials file does not exist", () => {
    expect(loadOpenSkyCredentials("/nonexistent/credentials.json")).toBeUndefined();
  });

  it("parses clientId/clientSecret from a valid credentials file", () => {
    dir = mkdtempSync(join(tmpdir(), "opensky-creds-"));
    const path = join(dir, "credentials.json");
    writeFileSync(
      path,
      JSON.stringify({ clientId: "abc", clientSecret: "xyz" }),
    );

    expect(loadOpenSkyCredentials(path)).toEqual({
      clientId: "abc",
      clientSecret: "xyz",
    });
  });

  it("throws on a malformed credentials file", () => {
    dir = mkdtempSync(join(tmpdir(), "opensky-creds-"));
    const path = join(dir, "credentials.json");
    writeFileSync(path, JSON.stringify({ clientId: "abc" }));

    expect(() => loadOpenSkyCredentials(path)).toThrow();
  });
});
