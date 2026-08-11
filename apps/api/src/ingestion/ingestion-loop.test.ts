import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { CanonicalTelemetryEvent } from "@repo/contracts";
import type { ProviderAdapter } from "../adapters/provider-adapter.js";
import { InMemoryEventBus } from "../event-bus/in-memory-event-bus.js";
import type { DomainEvent } from "../event-bus/domain-events.js";
import { startIngestionLoop } from "./ingestion-loop.js";

function fakeLogger(): FastifyBaseLogger {
  return { error: vi.fn() } as unknown as FastifyBaseLogger;
}

function canonicalEvent(vehicleId: string): CanonicalTelemetryEvent {
  return {
    eventId: `event-${vehicleId}`,
    vehicleId,
    source: "opensky",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    telemetry: { latitude: 51.5, longitude: -0.12 },
  };
}

function fakeAdapter(poll: ProviderAdapter["poll"]): ProviderAdapter {
  return { source: "opensky", poll };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startIngestionLoop", () => {
  it("polls immediately and publishes each returned event onto the bus", async () => {
    const adapter = fakeAdapter(vi.fn().mockResolvedValue([canonicalEvent("a")]));
    const eventBus = new InMemoryEventBus<DomainEvent>();
    const publish = vi.spyOn(eventBus, "publish");

    const loop = startIngestionLoop({
      adapter,
      eventBus,
      log: fakeLogger(),
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.poll).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      type: "telemetry.received",
      event: canonicalEvent("a"),
    });

    loop.stop();
  });

  it("schedules the next poll after pollIntervalMs on success", async () => {
    const poll = vi.fn().mockResolvedValue([]);
    const adapter = fakeAdapter(poll);
    const loop = startIngestionLoop({
      adapter,
      eventBus: new InMemoryEventBus<DomainEvent>(),
      log: fakeLogger(),
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("logs and does not throw when poll fails, retrying with backoff", async () => {
    const poll = vi.fn().mockRejectedValue(new Error("network down"));
    const adapter = fakeAdapter(poll);
    const log = fakeLogger();
    const loop = startIngestionLoop({
      adapter,
      eventBus: new InMemoryEventBus<DomainEvent>(),
      log,
      pollIntervalMs: 1000,
      maxBackoffMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ source: "opensky", consecutiveFailures: 1 }),
      "provider poll failed",
    );

    // First retry backs off 2x the interval (2000ms), not immediately.
    await vi.advanceTimersByTimeAsync(1999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);

    // Second retry backs off 4x the interval (4000ms).
    await vi.advanceTimersByTimeAsync(3999);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(3);

    // Third retry would be 8x (8000ms) but is capped at maxBackoffMs (5000ms).
    await vi.advanceTimersByTimeAsync(4999);
    expect(poll).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(4);

    loop.stop();
  });

  it("resets the backoff after a subsequent success", async () => {
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue([]);
    const adapter = fakeAdapter(poll);
    const loop = startIngestionLoop({
      adapter,
      eventBus: new InMemoryEventBus<DomainEvent>(),
      log: fakeLogger(),
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000); // backoff for failure #1
    expect(poll).toHaveBeenCalledTimes(2);

    // Next poll should be back to the plain interval, not another backoff.
    await vi.advanceTimersByTimeAsync(999);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(3);

    loop.stop();
  });

  it("stop() prevents any further polls", async () => {
    const poll = vi.fn().mockResolvedValue([]);
    const adapter = fakeAdapter(poll);
    const loop = startIngestionLoop({
      adapter,
      eventBus: new InMemoryEventBus<DomainEvent>(),
      log: fakeLogger(),
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    loop.stop();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
