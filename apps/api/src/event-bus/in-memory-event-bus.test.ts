import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { InMemoryEventBus } from "./in-memory-event-bus.js";

type TestEvent =
  | { type: "a"; value: number }
  | { type: "b"; value: string };

function fakeLogger(): FastifyBaseLogger {
  return { error: vi.fn() } as unknown as FastifyBaseLogger;
}

describe("InMemoryEventBus", () => {
  it("delivers a published event to all subscribers of the matching type", async () => {
    const bus = new InMemoryEventBus<TestEvent>();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe("a", first);
    bus.subscribe("a", second);

    await bus.publish({ type: "a", value: 1 });

    expect(first).toHaveBeenCalledWith({ type: "a", value: 1 });
    expect(second).toHaveBeenCalledWith({ type: "a", value: 1 });
  });

  it("does not deliver to subscribers of a different type", async () => {
    const bus = new InMemoryEventBus<TestEvent>();
    const aHandler = vi.fn();
    const bHandler = vi.fn();
    bus.subscribe("a", aHandler);
    bus.subscribe("b", bHandler);

    await bus.publish({ type: "a", value: 1 });

    expect(aHandler).toHaveBeenCalledTimes(1);
    expect(bHandler).not.toHaveBeenCalled();
  });

  it("isolates handler errors so other subscribers still run and publish resolves", async () => {
    const log = fakeLogger();
    const bus = new InMemoryEventBus<TestEvent>(log);
    const error = new Error("boom");
    const failing = vi.fn().mockRejectedValue(error);
    const succeeding = vi.fn();
    bus.subscribe("a", failing);
    bus.subscribe("a", succeeding);

    await expect(bus.publish({ type: "a", value: 1 })).resolves.toBeUndefined();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      { err: error, eventType: "a" },
      "event bus handler failed",
    );
  });

  it("is a no-op when there are no subscribers for the event type", async () => {
    const bus = new InMemoryEventBus<TestEvent>();

    await expect(bus.publish({ type: "a", value: 1 })).resolves.toBeUndefined();
  });
});
