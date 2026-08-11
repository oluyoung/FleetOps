import type { FastifyBaseLogger } from "fastify";
import { logger } from "../logger.js";
import type { EventBus } from "./event-bus.js";

type Handler<TEvent> = (event: TEvent) => Promise<void> | void;

export class InMemoryEventBus<TEvent extends { type: string }>
  implements EventBus<TEvent>
{
  private readonly handlersByType = new Map<
    TEvent["type"],
    Array<Handler<TEvent>>
  >();

  constructor(private readonly log: FastifyBaseLogger = logger) {}

  subscribe<TType extends TEvent["type"]>(
    type: TType,
    handler: (event: Extract<TEvent, { type: TType }>) => Promise<void> | void,
  ): void {
    const handlers = this.handlersByType.get(type) ?? [];
    handlers.push(handler as Handler<TEvent>);
    this.handlersByType.set(type, handlers);
  }

  async publish(event: TEvent): Promise<void> {
    const handlers = this.handlersByType.get(event.type) ?? [];
    // A handler throwing must not stop the others from running, or affect
    // the publisher — errors are logged and swallowed here.
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          this.log.error(
            { err: error, eventType: event.type },
            "event bus handler failed",
          );
        }
      }),
    );
  }
}
