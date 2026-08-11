import { describe, expect, it, vi } from "vitest";
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
  it("logs a connectionId at info level on subscribe and on close", () => {
    const log = fakeLogger();
    const gateway = new RealtimeGateway(log as unknown as FastifyBaseLogger);
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
  });

  it("logs each delivered update at debug level with the connection's id", () => {
    const log = fakeLogger();
    const gateway = new RealtimeGateway(log as unknown as FastifyBaseLogger);
    const socket = fakeSocket();
    gateway.subscribe("fleet:default", socket);
    const [firstCall] = log.info.mock.calls;
    const connectionId = firstCall?.[0].connectionId as string;

    gateway.broadcast("fleet:default", {
      type: "vehicle.updated",
      entityId: "vehicle-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { id: "vehicle-1" },
    });

    expect(socket.send).toHaveBeenCalledOnce();
    expect(log.debug).toHaveBeenCalledWith(
      {
        connectionId,
        scope: "fleet:default",
        entityId: "vehicle-1",
        sequence: 1,
      },
      "realtime update delivered",
    );
  });
});
