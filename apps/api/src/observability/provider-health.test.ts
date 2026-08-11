import { beforeEach, describe, expect, it } from "vitest";
import {
  metricsRegistry,
  providerErrorsTotal,
  providerLastSuccessTimestamp,
  telemetryEventsReceivedTotal,
  telemetryIngestionLagMs,
} from "./metrics.js";
import { deriveProviderHealth } from "./provider-health.js";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");

beforeEach(() => {
  metricsRegistry.resetMetrics();
});

describe("deriveProviderHealth", () => {
  it("is DEGRADED for a provider that has never succeeded", async () => {
    const health = await deriveProviderHealth({ opensky: 15_000 }, NOW);
    const opensky = health.find((p) => p.provider === "opensky");

    expect(opensky).toMatchObject({
      status: "DEGRADED",
      lastSuccessAt: null,
      msSinceLastSuccess: null,
    });
  });

  it("is HEALTHY when the provider has succeeded recently with no errors", async () => {
    providerLastSuccessTimestamp.set(
      { provider: "opensky" },
      (NOW - 5_000) / 1000,
    );
    telemetryEventsReceivedTotal.inc({ provider: "opensky" }, 10);

    const health = await deriveProviderHealth({ opensky: 15_000 }, NOW);
    const opensky = health.find((p) => p.provider === "opensky");

    expect(opensky?.status).toBe("HEALTHY");
    expect(opensky?.msSinceLastSuccess).toBe(5_000);
    expect(opensky?.eventsReceivedTotal).toBe(10);
  });

  it("is DEGRADED once the last success is older than the stale threshold", async () => {
    // opensky polls every 15s -> stale after 3x = 45s.
    providerLastSuccessTimestamp.set(
      { provider: "opensky" },
      (NOW - 46_000) / 1000,
    );

    const health = await deriveProviderHealth({ opensky: 15_000 }, NOW);
    const opensky = health.find((p) => p.provider === "opensky");

    expect(opensky?.status).toBe("DEGRADED");
  });

  it("uses the 30s floor for a provider with a fast poll interval", async () => {
    // mqtt drains every 1s -> 3x would be 3s, but the floor is 30s.
    providerLastSuccessTimestamp.set({ provider: "mqtt" }, (NOW - 20_000) / 1000);

    const health = await deriveProviderHealth({ mqtt: 1_000 }, NOW);
    const mqtt = health.find((p) => p.provider === "mqtt");

    expect(mqtt?.status).toBe("HEALTHY");
  });

  it("is DEGRADED when average ingestion lag exceeds the threshold", async () => {
    providerLastSuccessTimestamp.set(
      { provider: "open-meteo" },
      (NOW - 1_000) / 1000,
    );
    telemetryIngestionLagMs.observe({ provider: "open-meteo" }, 40_000);

    const health = await deriveProviderHealth({ "open-meteo": 600_000 }, NOW);
    const openMeteo = health.find((p) => p.provider === "open-meteo");

    expect(openMeteo?.status).toBe("DEGRADED");
    expect(openMeteo?.avgIngestionLagMs).toBe(40_000);
  });

  it("is DEGRADED when the error ratio is persistently high", async () => {
    providerLastSuccessTimestamp.set({ provider: "mqtt" }, (NOW - 1_000) / 1000);
    telemetryEventsReceivedTotal.inc({ provider: "mqtt" }, 2);
    providerErrorsTotal.inc({ provider: "mqtt" }, 5);

    const health = await deriveProviderHealth({ mqtt: 1_000 }, NOW);
    const mqtt = health.find((p) => p.provider === "mqtt");

    expect(mqtt?.status).toBe("DEGRADED");
    expect(mqtt?.errorsTotal).toBe(5);
  });

  it("tolerates a small number of errors without flipping to DEGRADED", async () => {
    providerLastSuccessTimestamp.set({ provider: "mqtt" }, (NOW - 1_000) / 1000);
    telemetryEventsReceivedTotal.inc({ provider: "mqtt" }, 100);
    providerErrorsTotal.inc({ provider: "mqtt" }, 2);

    const health = await deriveProviderHealth({ mqtt: 1_000 }, NOW);
    const mqtt = health.find((p) => p.provider === "mqtt");

    expect(mqtt?.status).toBe("HEALTHY");
  });

  it("returns an entry for every known provider", async () => {
    const health = await deriveProviderHealth({}, NOW);
    expect(health.map((p) => p.provider).sort()).toEqual([
      "mqtt",
      "open-meteo",
      "opensky",
    ]);
  });
});
