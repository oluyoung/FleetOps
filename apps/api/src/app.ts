import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import type { Pool } from "pg";
import type { TelemetrySource } from "@repo/contracts";
import type { EventBus } from "./event-bus/event-bus.js";
import type { DomainEvent } from "./event-bus/domain-events.js";
import { logger } from "./logger.js";
import {
  PostgresVehicleRepository,
  type VehicleRepository,
} from "./vehicles/vehicle-repository.js";
import { registerVehicleStateSubscriber } from "./vehicles/vehicle-state-subscriber.js";
import { RealtimeGateway } from "./realtime/realtime-gateway.js";
import { metricsRegistry } from "./observability/metrics.js";
import { deriveProviderHealth } from "./observability/provider-health.js";

// Single hardcoded fleet scope for M1 — multi-tenancy is out of scope
// (RFC-002/ADR-003).
const DEFAULT_FLEET_SCOPE = "fleet:default";

export async function buildApp(deps: {
  db: Pool;
  eventBus: EventBus<DomainEvent>;
  // Per ADR-010: how often replaceable telemetry is coalesced and flushed
  // at the WebSocket delivery boundary. Defaults to the 500ms called out in
  // IMPLEMENTATION_PLAN.md Step 17 when not supplied by the caller.
  telemetryPushIntervalMs?: number;
  // Each provider's configured poll interval, used only to size the
  // staleness threshold in GET /providers/health (Step 18).
  providerPollIntervalsMs?: Partial<Record<TelemetrySource, number>>;
}): Promise<{
  app: FastifyInstance;
  vehicleRepository: VehicleRepository;
  realtimeGateway: RealtimeGateway;
}> {
  const app = Fastify({ loggerInstance: logger });

  await app.register(fastifyCors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });
  await app.register(fastifyWebsocket);

  const vehicleRepository = new PostgresVehicleRepository(deps.db);
  const realtimeGateway = new RealtimeGateway(
    app.log,
    deps.telemetryPushIntervalMs ?? 500,
  );
  registerVehicleStateSubscriber(
    deps.eventBus,
    vehicleRepository,
    realtimeGateway,
    DEFAULT_FLEET_SCOPE,
    app.log,
  );

  app.get<{ Querystring: { reconnect?: string } }>(
    "/ws",
    { websocket: true },
    (socket, request) => {
      realtimeGateway.subscribe(
        DEFAULT_FLEET_SCOPE,
        socket,
        request.query.reconnect === "true",
      );
    },
  );

  app.get("/health", async () => {
    await deps.db.query("SELECT 1");
    return { status: "ok" };
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });

  app.get("/providers/health", async () => {
    return { providers: await deriveProviderHealth(deps.providerPollIntervalsMs ?? {}) };
  });

  app.get("/vehicles", async () => {
    return vehicleRepository.findAll();
  });

  app.get<{ Params: { id: string } }>(
    "/vehicles/:id",
    async (request, reply) => {
      const vehicle = await vehicleRepository.findById(request.params.id);
      if (!vehicle) {
        return reply.status(404).send({
          error: "NotFound",
          message: `vehicle ${request.params.id} not found`,
        });
      }
      return vehicle;
    },
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "unhandled request error");
    reply.status(error.statusCode ?? 500).send({
      error: error.name,
      message: error.message,
    });
  });

  return { app, vehicleRepository, realtimeGateway };
}
