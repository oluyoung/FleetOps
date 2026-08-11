import { z } from "zod";

export const RealtimeEventTypeSchema = z.enum([
  "vehicle.updated",
  "vehicle.offline",
  "vehicle.faulted",
]);
export type RealtimeEventType = z.infer<typeof RealtimeEventTypeSchema>;

/**
 * Delta envelope pushed over WebSocket (RFC-002/ADR-003). REST snapshots
 * remain authoritative; sequence numbers are per-entity, not globally
 * ordered, so clients only need to detect gaps for the entity they hold.
 */
export function RealtimeEventSchema<T extends z.ZodTypeAny>(payload: T) {
  return z.object({
    type: RealtimeEventTypeSchema,
    scope: z.string().min(1), // e.g. "fleet:default", "vehicle:{id}"
    entityId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    occurredAt: z.string().datetime(),
    payload,
  });
}
export type RealtimeEvent<T> = {
  type: RealtimeEventType;
  scope: string;
  entityId: string;
  sequence: number;
  occurredAt: string;
  payload: T;
};
