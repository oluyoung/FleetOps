/**
 * Per ADR-006: in-process pub/sub so vehicle state, alerts and realtime
 * delivery can react to domain events without calling each other directly.
 * No durable replay, cross-process delivery or broker retries — single
 * process only, revisit if that stops being true.
 */
export interface EventBus<TEvent extends { type: string }> {
  publish(event: TEvent): Promise<void>;

  subscribe<TType extends TEvent["type"]>(
    type: TType,
    handler: (event: Extract<TEvent, { type: TType }>) => Promise<void> | void,
  ): void;
}
