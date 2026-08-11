import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { RealtimeGateway } from "./realtime-gateway.js";

function fakeLogger() {
  return {
    info: vi.fn<(obj: Record<string, unknown>, msg: string) => void>(),
    debug: vi.fn<(obj: Record<string, unknown>, msg: string) => void>(),
  };
}

function fakeSocket(): WebSocket & { emit(event: "close"): void } {
  const listeners = new Map<string, Array<() => void>>();
  return {
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    on(event: string, handler: () => void) {
      const handlers = listeners.get(event) ?? [];
      handlers.push(handler);
      listeners.set(event, handlers);
    },
    emit(event: "close") {
      for (const handler of listeners.get(event) ?? []) handler();
    },
  } as unknown as WebSocket & { emit(event: "close"): void };
}

describe("RealtimeGateway", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs a connectionId at info level on subscribe and on close", () => {
    const log = fakeLogger();
    const gateway = new RealtimeGateway(log as unknown as FastifyBaseLogger, 500);
    const socket = fakeSocket();

    gateway.subscribe("fleet:default", socket);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "fleet:default" }),
      "websocket connected",
    );
    const [firstCall] = log.info.mock.calls;
    const connectionId = firstCall?.[0].connectionId as string;
    expect(connectionId).toMatch(/^[0-9a-f-]{36}$/);

    socket.emit("close");
    expect(log.info).toHaveBeenCalledWith(
      { connectionId, scope: "fleet:default" },
      "websocket disconnected",
    );
    gateway.stop();
  });

  it("coalesces replaceable updates and delivers the latest on the next flush", () => {
    const log = fakeLogger();
    const gateway = new RealtimeGateway(log as unknown as FastifyBaseLogger, 500);
    const socket = fakeSocket();
    gateway.subscribe("fleet:default", socket);
    const [firstCall] = log.info.mock.calls;
    const connectionId = firstCall?.[0].connectionId as string;

    gateway.broadcast("fleet:default", {
      type: "vehicle.updated",
      entityId: "vehicle-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { id: "vehicle-1", speedMps: 100 },
    });
    // A second update for the same entity before the flush tick supersedes
    // the first — it should never be sent on its own.
    gateway.broadcast("fleet:default", {
      type: "vehicle.updated",
      entityId: "vehicle-1",
      occurredAt: "2026-01-01T00:00:00.200Z",
      payload: { id: "vehicle-1", speedMps: 120 },
    });

    expect(socket.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(socket.send).toHaveBeenCalledOnce();
    const sendMock = socket.send as ReturnType<typeof vi.fn>;
    const sent = JSON.parse(sendMock.mock.calls[0]![0]);
    expect(sent).toMatchObject({
      entityId: "vehicle-1",
      sequence: 1,
      payload: { id: "vehicle-1", speedMps: 120 },
    });
    expect(log.debug).toHaveBeenCalledWith(
      {
        connectionId,
        scope: "fleet:default",
        entityId: "vehicle-1",
        sequence: 1,
      },
      "realtime update delivered",
    );
    gateway.stop();
  });

  it("delivers critical events immediately, bypassing aggregation", () => {
    const log = fakeLogger();
    const gateway = new RealtimeGateway(log as unknown as FastifyBaseLogger, 500);
    const socket = fakeSocket();
    gateway.subscribe("fleet:default", socket);

    gateway.broadcast("fleet:default", {
      type: "vehicle.offline",
      entityId: "vehicle-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { id: "vehicle-1" },
    });

    expect(socket.send).toHaveBeenCalledOnce();
    gateway.stop();
  });

  it("drops the oldest queued replaceable update once a connection's bounded queue is full", () => {
    const log = fakeLogger();
    const gateway = new RealtimeGateway(log as unknown as FastifyBaseLogger, 500);
    const socket = fakeSocket();
    // Keep the socket permanently backpressured so flushed updates queue up
    // instead of being sent, exercising the drop-oldest bound.
    Object.defineProperty(socket, "bufferedAmount", {
      value: 5_000_000,
      writable: false,
    });
    gateway.subscribe("fleet:default", socket);

    for (let i = 0; i < 60; i++) {
      gateway.broadcast("fleet:default", {
        type: "vehicle.updated",
        entityId: `vehicle-${i}`,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { id: `vehicle-${i}` },
      });
      vi.advanceTimersByTime(500);
    }

    expect(socket.send).not.toHaveBeenCalled();
    gateway.stop();
  });
});
