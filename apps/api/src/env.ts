function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  mqttUrl: process.env.MQTT_URL ?? "mqtt://localhost:1883",
  telemetryPushIntervalMs: Number(
    process.env.TELEMETRY_PUSH_INTERVAL_MS ?? 500,
  ),
  openSkyPollIntervalMs: Number(process.env.OPENSKY_POLL_INTERVAL_MS ?? 15000),
};
