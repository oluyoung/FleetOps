import crypto from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import { z } from "zod";
import { CanonicalTelemetryEventSchema } from "@repo/contracts";
import type { CanonicalTelemetryEvent } from "@repo/contracts";
import type { ProviderAdapter } from "./provider-adapter.js";

const DEFAULT_TOPIC = "fleet/+/health";

const healthPayloadSchema = z.object({
  eventId: z.string().uuid().optional(),
  vehicleId: z.string().min(1),
  batteryPercent: z.number().min(0).max(100).optional(),
  motorTemperatureC: z.number().optional(),
  connectivity: z.enum(["good", "degraded", "offline"]).optional(),
  heartbeatAt: z.string(),
});

/**
 * Maps one `apps/telemetry-publisher` health message to a
 * CanonicalTelemetryEvent. Returns null for malformed payloads (RFC-001:
 * rejected before they reach the domain) rather than throwing — one bad
 * message on the topic must not take down the MQTT connection.
 */
export function mapHealthPayloadToEvent(
  raw: unknown,
): CanonicalTelemetryEvent | null {
  const parsed = healthPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;

  const heartbeat = new Date(parsed.data.heartbeatAt);
  if (Number.isNaN(heartbeat.getTime())) return null;

  const candidate = {
    eventId: parsed.data.eventId ?? crypto.randomUUID(),
    // Provider-owned ids are namespaced per ADR-005 so they can never
    // collide with another source's identity space before Step 13 unifies
    // multi-source vehicle identity.
    vehicleId: `mqtt-${parsed.data.vehicleId}`,
    source: "mqtt" as const,
    occurredAt: heartbeat.toISOString(),
    receivedAt: new Date().toISOString(),
    telemetry: {
      ...(typeof parsed.data.batteryPercent === "number"
        ? { batteryPercent: parsed.data.batteryPercent }
        : {}),
      ...(typeof parsed.data.motorTemperatureC === "number"
        ? { motorTemperatureC: parsed.data.motorTemperatureC }
        : {}),
      ...(parsed.data.connectivity
        ? { connectivity: parsed.data.connectivity }
        : {}),
    },
  };

  const validated = CanonicalTelemetryEventSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}

export type MqttConnectFn = (url: string) => MqttClient;

/**
 * Per ADR-005: implements the same ProviderAdapter interface as the polling
 * adapters, but the transport underneath is subscribe-driven — proving the
 * adapter boundary generalises across transport shapes, not just providers
 * (RFC-001). The MQTT client subscribes once and buffers canonical events as
 * messages arrive; poll() just drains that buffer, so the existing
 * setTimeout-based ingestion loop can host it unchanged.
 */
export class MqttAdapter implements ProviderAdapter {
  readonly source = "mqtt" as const;

  private client: MqttClient | null = null;
  private connecting: Promise<void> | null = null;
  private queue: CanonicalTelemetryEvent[] = [];

  constructor(
    private readonly url: string,
    private readonly topic: string = DEFAULT_TOPIC,
    private readonly connectFn: MqttConnectFn = (target) =>
      mqtt.connect(target),
  ) {}

  async poll(): Promise<CanonicalTelemetryEvent[]> {
    await this.ensureConnected();
    if (this.queue.length === 0) return [];
    const events = this.queue;
    this.queue = [];
    return events;
  }

  /** Closes the underlying MQTT connection — called on process shutdown. */
  disconnect(): void {
    this.client?.end(true);
    this.client = null;
    this.connecting = null;
  }

  private ensureConnected(): Promise<void> {
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      const client = this.connectFn(this.url);
      this.client = client;

      client.once("connect", () => {
        client.subscribe(this.topic, { qos: 1 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      client.on("message", (_topic, payload) => {
        let raw: unknown;
        try {
          raw = JSON.parse(payload.toString());
        } catch {
          return;
        }
        const event = mapHealthPayloadToEvent(raw);
        if (event) this.queue.push(event);
      });

      // Only the connect/subscribe handshake rejects poll() and triggers the
      // ingestion loop's backoff — once connected, mqtt.js's own automatic
      // reconnect handles drops without crashing the process (RFC-001).
      client.once("error", reject);
    }).catch((err: unknown) => {
      this.connecting = null;
      throw err;
    });

    return this.connecting;
  }
}
