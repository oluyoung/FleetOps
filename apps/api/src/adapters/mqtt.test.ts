import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { MqttClient } from "mqtt";
import {
  mapHealthPayloadToEvent,
  MqttAdapter,
  type MqttConnectFn,
} from "./mqtt.js";

describe("mapHealthPayloadToEvent", () => {
  const validPayload = {
    eventId: "6f8f7f1a-0e2b-4a3a-8b1a-6b0f8c9d2e1f",
    vehicleId: "vehicle-001",
    batteryPercent: 88,
    motorTemperatureC: 42,
    connectivity: "good" as const,
    heartbeatAt: "2026-01-01T00:00:00.000Z",
    sequence: 3,
  };

  it("maps a valid health payload to a canonical event", () => {
    const event = mapHealthPayloadToEvent(validPayload);

    expect(event).not.toBeNull();
    expect(event?.eventId).toBe(validPayload.eventId);
    expect(event?.vehicleId).toBe("mqtt-vehicle-001");
    expect(event?.source).toBe("mqtt");
    expect(event?.occurredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(event?.telemetry).toEqual({
      batteryPercent: 88,
      motorTemperatureC: 42,
      connectivity: "good",
    });
  });

  it("generates an eventId when the payload doesn't carry one", () => {
    const withoutEventId: Record<string, unknown> = { ...validPayload };
    delete withoutEventId.eventId;
    const event = mapHealthPayloadToEvent(withoutEventId);

    expect(event?.eventId).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it("returns null for a payload missing vehicleId", () => {
    const invalid: Record<string, unknown> = { ...validPayload };
    delete invalid.vehicleId;
    expect(mapHealthPayloadToEvent(invalid)).toBeNull();
  });

  it("returns null for an unparseable heartbeatAt", () => {
    expect(
      mapHealthPayloadToEvent({ ...validPayload, heartbeatAt: "not-a-date" }),
    ).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(mapHealthPayloadToEvent("not-json")).toBeNull();
    expect(mapHealthPayloadToEvent(null)).toBeNull();
  });

  it("omits telemetry fields the payload didn't include", () => {
    const event = mapHealthPayloadToEvent({
      vehicleId: "vehicle-002",
      heartbeatAt: "2026-01-01T00:00:00.000Z",
    });

    expect(event?.telemetry).toEqual({});
  });
});

class FakeMqttClient extends EventEmitter {
  subscribeCalls: string[] = [];
  ended = false;

  subscribe(
    topic: string,
    _opts: unknown,
    callback: (err: Error | null) => void,
  ) {
    this.subscribeCalls.push(topic);
    callback(null);
  }

  end() {
    this.ended = true;
  }

  publishMessage(topic: string, payload: unknown) {
    this.emit("message", topic, Buffer.from(JSON.stringify(payload)));
  }
}

function fakeConnect(client: FakeMqttClient): MqttConnectFn {
  return vi.fn().mockReturnValue(client as unknown as MqttClient);
}

describe("MqttAdapter.poll", () => {
  it("connects and subscribes once, returning [] before any message arrives", async () => {
    const client = new FakeMqttClient();
    const connectFn = fakeConnect(client);
    const adapter = new MqttAdapter("mqtt://broker", "fleet/+/health", connectFn);

    queueMicrotask(() => client.emit("connect"));
    const events = await adapter.poll();

    expect(events).toEqual([]);
    expect(client.subscribeCalls).toEqual(["fleet/+/health"]);
    expect(connectFn).toHaveBeenCalledTimes(1);
  });

  it("buffers messages received between polls and drains them on poll()", async () => {
    const client = new FakeMqttClient();
    const adapter = new MqttAdapter(
      "mqtt://broker",
      "fleet/+/health",
      fakeConnect(client),
    );

    queueMicrotask(() => client.emit("connect"));
    await adapter.poll();

    client.publishMessage("fleet/vehicle-001/health", {
      vehicleId: "vehicle-001",
      batteryPercent: 90,
      heartbeatAt: "2026-01-01T00:00:00.000Z",
    });
    client.publishMessage("fleet/vehicle-002/health", {
      vehicleId: "vehicle-002",
      batteryPercent: 70,
      heartbeatAt: "2026-01-01T00:00:01.000Z",
    });

    const events = await adapter.poll();

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.vehicleId).sort()).toEqual([
      "mqtt-vehicle-001",
      "mqtt-vehicle-002",
    ]);
    // Second drain within the same connection returns nothing new.
    expect(await adapter.poll()).toEqual([]);
  });

  it("ignores an unparseable message instead of throwing", async () => {
    const client = new FakeMqttClient();
    const adapter = new MqttAdapter(
      "mqtt://broker",
      "fleet/+/health",
      fakeConnect(client),
    );

    queueMicrotask(() => client.emit("connect"));
    await adapter.poll();

    client.emit("message", "fleet/x/health", Buffer.from("not json"));

    expect(await adapter.poll()).toEqual([]);
  });

  it("rejects poll() when the initial connection errors, and retries on the next poll", async () => {
    const client = new FakeMqttClient();
    const adapter = new MqttAdapter(
      "mqtt://broker",
      "fleet/+/health",
      fakeConnect(client),
    );

    queueMicrotask(() => client.emit("error", new Error("connection refused")));
    await expect(adapter.poll()).rejects.toThrow("connection refused");

    const secondClient = new FakeMqttClient();
    const secondConnectFn = fakeConnect(secondClient);
    const retryAdapter = new MqttAdapter(
      "mqtt://broker",
      "fleet/+/health",
      secondConnectFn,
    );
    queueMicrotask(() => secondClient.emit("connect"));
    await expect(retryAdapter.poll()).resolves.toEqual([]);
  });

  it("disconnect() ends the underlying client", async () => {
    const client = new FakeMqttClient();
    const adapter = new MqttAdapter(
      "mqtt://broker",
      "fleet/+/health",
      fakeConnect(client),
    );

    queueMicrotask(() => client.emit("connect"));
    await adapter.poll();

    adapter.disconnect();
    expect(client.ended).toBe(true);
  });
});
