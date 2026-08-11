import "dotenv/config";
import crypto from "node:crypto";
import mqtt from "mqtt";

/**
 * Simulates realistic vehicle-health telemetry on a fixed interval.
 * Only wired into Milestone 2 (MQTT ingestion) — scaffolded now so the
 * workspace/Docker Compose story is complete from day one. The publisher
 * emits raw measurements only; it never derives domain alerts (RFC-001 —
 * that's the IoT adapter + domain layer's job, not the source).
 */
type VehicleHealth = {
  vehicleId: string;
  batteryPercent: number;
  motorTemperatureC: number;
  connectivity: "good" | "degraded" | "offline";
  heartbeatAt: string;
  sequence: number;
};

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const PUBLISH_INTERVAL_MS = 1000;

const vehicles: VehicleHealth[] = [
  {
    vehicleId: "vehicle-001",
    batteryPercent: 88,
    motorTemperatureC: 42,
    connectivity: "good",
    heartbeatAt: new Date().toISOString(),
    sequence: 0,
  },
  {
    vehicleId: "vehicle-002",
    batteryPercent: 67,
    motorTemperatureC: 47,
    connectivity: "good",
    heartbeatAt: new Date().toISOString(),
    sequence: 0,
  },
  {
    vehicleId: "vehicle-003",
    batteryPercent: 51,
    motorTemperatureC: 45,
    connectivity: "good",
    heartbeatAt: new Date().toISOString(),
    sequence: 0,
  },
];

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function nextTelemetry(current: VehicleHealth): VehicleHealth {
  const batteryDrain = randomBetween(0.02, 0.12);
  const temperatureDelta = randomBetween(-0.8, 1.2);

  const nextBattery = Math.max(0, current.batteryPercent - batteryDrain);
  const nextTemperature = Math.max(
    20,
    Math.min(100, current.motorTemperatureC + temperatureDelta),
  );

  const connectivity: VehicleHealth["connectivity"] =
    Math.random() < 0.03 ? "degraded" : "good";

  return {
    ...current,
    batteryPercent: Number(nextBattery.toFixed(2)),
    motorTemperatureC: Number(nextTemperature.toFixed(1)),
    connectivity,
    heartbeatAt: new Date().toISOString(),
    sequence: current.sequence + 1,
  };
}

function publishVehicle(client: mqtt.MqttClient, telemetry: VehicleHealth) {
  const topic = `fleet/${telemetry.vehicleId}/health`;
  const message = { eventId: crypto.randomUUID(), ...telemetry };
  client.publish(topic, JSON.stringify(message), { qos: 1, retain: false });
}

const client = mqtt.connect(MQTT_URL);

client.on("connect", () => {
  console.log(`telemetry-publisher connected to ${MQTT_URL}`);

  setInterval(() => {
    for (let index = 0; index < vehicles.length; index++) {
      const updated = nextTelemetry(vehicles[index]!);
      vehicles[index] = updated;
      publishVehicle(client, updated);
    }
  }, PUBLISH_INTERVAL_MS);
});
