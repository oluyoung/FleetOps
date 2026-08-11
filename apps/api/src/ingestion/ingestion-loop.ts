import type { FastifyBaseLogger } from "fastify";
import type { ProviderAdapter } from "../adapters/provider-adapter.js";
import type { EventBus } from "../event-bus/event-bus.js";
import type { DomainEvent } from "../event-bus/domain-events.js";
import { recordProviderError } from "../observability/provider-errors.js";

export interface IngestionLoopOptions {
  adapter: ProviderAdapter;
  eventBus: EventBus<DomainEvent>;
  log: FastifyBaseLogger;
  pollIntervalMs: number;
  maxBackoffMs?: number;
}

export interface IngestionLoop {
  stop(): void;
}

/**
 * Polls a ProviderAdapter on an interval and publishes each canonical event
 * onto the EventBus. Self-reschedules via setTimeout (not setInterval) so a
 * slow poll can't overlap with itself and so a failed poll can back off
 * before retrying instead of hammering the provider — per RFC-001, transient
 * provider failures use bounded retry/backoff and never crash the process.
 */
export function startIngestionLoop(options: IngestionLoopOptions): IngestionLoop {
  const { adapter, eventBus, log, pollIntervalMs } = options;
  const maxBackoffMs = options.maxBackoffMs ?? pollIntervalMs * 8;

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let consecutiveFailures = 0;

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(runOnce, delayMs);
  };

  async function runOnce() {
    try {
      const events = await adapter.poll();
      for (const event of events) {
        await eventBus.publish({ type: "telemetry.received", event });
      }
      consecutiveFailures = 0;
      scheduleNext(pollIntervalMs);
    } catch (err) {
      consecutiveFailures += 1;
      recordProviderError(adapter.source);
      log.error(
        { err, source: adapter.source, consecutiveFailures },
        "provider poll failed",
      );
      const backoffMs = Math.min(
        pollIntervalMs * 2 ** consecutiveFailures,
        maxBackoffMs,
      );
      scheduleNext(backoffMs);
    }
  }

  void runOnce();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
