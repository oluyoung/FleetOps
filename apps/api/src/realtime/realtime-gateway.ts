import crypto from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { RealtimeEventType } from "@repo/contracts";
import type { WebSocket } from "@fastify/websocket";
import {
  realtimeDeliveryErrorsTotal,
  realtimeUpdatesCoalescedTotal,
  realtimeUpdatesPublishedTotal,
  websocketConnectionsActive,
  websocketReconnectTotal,
} from "../observability/metrics.js";

export type RealtimeEnvelope<T> = {
  type: RealtimeEventType;
  scope: string;
  entityId: string;
  sequence: number;
  occurredAt: string;
  payload: T;
};

type OutgoingEvent<T> = {
  type: RealtimeEventType;
  entityId: string;
  occurredAt: string;
  payload: T;
};

// Replaceable telemetry (position/speed/heading/temperature) is the only
// type coalesced at the delivery boundary (ADR-010); everything else is a
// critical domain event and always bypasses aggregation.
const REPLACEABLE_TYPE: RealtimeEventType = "vehicle.updated";

// Bound on how many un-delivered replaceable updates we'll hold for one slow
// connection before dropping the oldest — protects memory under sustained
// backpressure instead of letting a stalled socket queue grow unbounded.
const MAX_QUEUED_PER_CONNECTION = 50;

// Above this much unflushed data already sitting in the OS/ws write buffer,
// treat the connection as backpressured and hold new replaceable updates in
// our own bounded queue rather than pile more onto the socket's buffer.
const BACKPRESSURE_BYTES = 1_000_000;

/**
 * Per ADR-003/RFC-002: broadcasts RealtimeEvent envelopes to every socket
 * subscribed to a scope (e.g. "fleet:default"). Sequence numbers are
 * per-entity so a slow/reconnecting client can detect gaps for the vehicle
 * it holds without needing a globally ordered stream.
 *
 * Per ADR-010, replaceable telemetry is aggregated at this delivery
 * boundary: updates for the same entity arriving within one
 * `pushIntervalMs` window collapse into a single flush, and each flush is
 * delivered through a bounded, drop-oldest per-connection queue so one slow
 * client can't back up delivery to the rest. Critical domain events skip
 * both and are delivered immediately.
 */
export class RealtimeGateway {
  private readonly connectionsByScope = new Map<string, Set<WebSocket>>();
  private readonly sequenceByEntity = new Map<string, number>();
  private readonly connectionIds = new WeakMap<WebSocket, string>();

  // scope -> entityId -> latest not-yet-flushed replaceable update.
  private readonly pendingByScope = new Map<
    string,
    Map<string, OutgoingEvent<unknown>>
  >();
  private readonly connectionQueues = new Map<
    WebSocket,
    RealtimeEnvelope<unknown>[]
  >();
  private readonly flushTimer: NodeJS.Timeout;

  constructor(
    private readonly log: FastifyBaseLogger,
    pushIntervalMs = 500,
  ) {
    this.flushTimer = setInterval(() => this.flushReplaceable(), pushIntervalMs);
    this.flushTimer.unref();
  }

  stop(): void {
    clearInterval(this.flushTimer);
  }

  subscribe(scope: string, socket: WebSocket, isReconnect = false): void {
    const connectionId = crypto.randomUUID();
    this.connectionIds.set(socket, connectionId);

    let sockets = this.connectionsByScope.get(scope);
    if (!sockets) {
      sockets = new Set();
      this.connectionsByScope.set(scope, sockets);
    }
    sockets.add(socket);
    websocketConnectionsActive.inc();
    if (isReconnect) websocketReconnectTotal.inc();
    this.log.info({ connectionId, scope }, "websocket connected");

    socket.on("close", () => {
      sockets!.delete(socket);
      if (sockets!.size === 0) {
        this.connectionsByScope.delete(scope);
      }
      this.connectionQueues.delete(socket);
      websocketConnectionsActive.dec();
      this.log.info({ connectionId, scope }, "websocket disconnected");
    });
  }

  /**
   * Critical domain events deliver immediately; replaceable telemetry is
   * buffered and coalesced until the next flush tick (ADR-010).
   */
  broadcast<T>(scope: string, event: OutgoingEvent<T>): void {
    if (event.type !== REPLACEABLE_TYPE) {
      this.deliverToScope(scope, this.nextEnvelope(scope, event));
      return;
    }

    let pending = this.pendingByScope.get(scope);
    if (!pending) {
      pending = new Map();
      this.pendingByScope.set(scope, pending);
    }
    if (pending.has(event.entityId)) {
      // A newer replaceable update supersedes one that never made it out —
      // that's the coalescing ADR-010 asks for.
      realtimeUpdatesCoalescedTotal.inc();
    }
    pending.set(event.entityId, event);
  }

  private flushReplaceable(): void {
    for (const [scope, pending] of this.pendingByScope) {
      if (pending.size === 0) continue;
      const sockets = this.connectionsByScope.get(scope);
      if (!sockets || sockets.size === 0) {
        pending.clear();
        continue;
      }

      const envelopes = [...pending.values()].map((event) =>
        this.nextEnvelope(scope, event),
      );
      pending.clear();

      for (const socket of sockets) {
        this.enqueueForConnection(socket, envelopes);
      }
    }
  }

  private nextEnvelope<T>(
    scope: string,
    event: OutgoingEvent<T>,
  ): RealtimeEnvelope<T> {
    const nextSequence = (this.sequenceByEntity.get(event.entityId) ?? 0) + 1;
    this.sequenceByEntity.set(event.entityId, nextSequence);
    return {
      type: event.type,
      scope,
      entityId: event.entityId,
      sequence: nextSequence,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
  }

  /** Delivers a single (critical) envelope to every socket in a scope. */
  private deliverToScope<T>(scope: string, envelope: RealtimeEnvelope<T>): void {
    const sockets = this.connectionsByScope.get(scope);
    if (!sockets || sockets.size === 0) return;
    for (const socket of sockets) {
      this.sendNow(socket, envelope);
    }
  }

  /** Queues replaceable envelopes for one connection, then drains what it can. */
  private enqueueForConnection(
    socket: WebSocket,
    envelopes: RealtimeEnvelope<unknown>[],
  ): void {
    const queue = this.connectionQueues.get(socket) ?? [];
    queue.push(...envelopes);
    while (queue.length > MAX_QUEUED_PER_CONNECTION) {
      queue.shift();
      realtimeUpdatesCoalescedTotal.inc();
    }
    this.connectionQueues.set(socket, queue);
    this.drainConnection(socket, queue);
  }

  /** Sends as much of a connection's queue as the socket can currently take. */
  private drainConnection(
    socket: WebSocket,
    queue: RealtimeEnvelope<unknown>[],
  ): void {
    if (socket.readyState !== socket.OPEN) return;
    while (queue.length > 0 && socket.bufferedAmount < BACKPRESSURE_BYTES) {
      const envelope = queue.shift()!;
      this.sendNow(socket, envelope);
    }
  }

  private sendNow<T>(socket: WebSocket, envelope: RealtimeEnvelope<T>): void {
    if (socket.readyState !== socket.OPEN) return;
    const connectionId = this.connectionIds.get(socket);
    try {
      socket.send(JSON.stringify(envelope));
      realtimeUpdatesPublishedTotal.inc();
      // Debug, not info: this fires once per event per connected socket —
      // the high-volume path ADR-012 says to keep out of info-level logs.
      this.log.debug(
        {
          connectionId,
          scope: envelope.scope,
          entityId: envelope.entityId,
          sequence: envelope.sequence,
        },
        "realtime update delivered",
      );
    } catch (err) {
      realtimeDeliveryErrorsTotal.inc();
      this.log.debug(
        { err, connectionId, scope: envelope.scope, entityId: envelope.entityId },
        "realtime update delivery failed",
      );
      // Ignore beyond logging: the "close" listener will clean this socket up.
    }
  }
}
