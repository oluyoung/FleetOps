# Fly.io app "fleetops-mqtt" — Eclipse Mosquitto broker, private-network only.
# Build from the monorepo root:
#   docker build -f infra/fly/mqtt/Dockerfile -t fleetops-mqtt .
#
# Reuses the same config already used for local dev (infra/mosquitto.conf) —
# no persistence needed, this only brokers live telemetry between
# apps/telemetry-publisher and apps/api's MqttAdapter.

FROM eclipse-mosquitto:2
COPY infra/mosquitto.conf /mosquitto/config/mosquitto.conf
