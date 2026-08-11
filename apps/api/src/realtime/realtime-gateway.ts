import type { RealtimeEventType } from "@repo/contracts";
import type { WebSocket } from "@fastify/websocket";

export type RealtimeEnvelope<T> = {
  type: RealtimeEventType;
  scope: string;
  entityId: string;
  sequence: number;
  occurredAt: string;
  payload: T;
};

/**
 * Per ADR-003/RFC-002: broadcasts RealtimeEvent envelopes to every socket
 * subscribed to a scope (e.g. "fleet:default"). Sequence numbers are
 * per-entity so a slow/reconnecting client can detect gaps for the vehicle
 * it holds without needing a globally ordered stream.
 */
export class RealtimeGateway {
  private readonly connectionsByScope = new Map<string, Set<WebSocket>>();
  private readonly sequenceByEntity = new Map<string, number>();

  subscribe(scope: string, socket: WebSocket): void {
    let sockets = this.connectionsByScope.get(scope);
    if (!sockets) {
      sockets = new Set();
      this.connectionsByScope.set(scope, sockets);
    }
    sockets.add(socket);

    socket.on("close", () => {
      sockets!.delete(socket);
      if (sockets!.size === 0) {
        this.connectionsByScope.delete(scope);
      }
    });
  }

  broadcast<T>(
    scope: string,
    event: {
      type: RealtimeEventType;
      entityId: string;
      occurredAt: string;
      payload: T;
    },
  ): void {
    const sockets = this.connectionsByScope.get(scope);
    if (!sockets || sockets.size === 0) return;

    const nextSequence = (this.sequenceByEntity.get(event.entityId) ?? 0) + 1;
    this.sequenceByEntity.set(event.entityId, nextSequence);

    const envelope: RealtimeEnvelope<T> = {
      type: event.type,
      scope,
      entityId: event.entityId,
      sequence: nextSequence,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
    const serialized = JSON.stringify(envelope);

    for (const socket of sockets) {
      // A slow/closed client must never break delivery to the rest.
      if (socket.readyState !== socket.OPEN) continue;
      try {
        socket.send(serialized);
      } catch {
        // Ignore: the "close" listener will clean this socket up.
      }
    }
  }
}
