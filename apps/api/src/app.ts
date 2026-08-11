import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import type { Pool } from "pg";
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

// Single hardcoded fleet scope for M1 — multi-tenancy is out of scope
// (RFC-002/ADR-003).
const DEFAULT_FLEET_SCOPE = "fleet:default";

export async function buildApp(deps: {
  db: Pool;
  eventBus: EventBus<DomainEvent>;
}): Promise<{ app: FastifyInstance; vehicleRepository: VehicleRepository }> {
  const app = Fastify({ loggerInstance: logger });

  await app.register(fastifyCors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });
  await app.register(fastifyWebsocket);

  const vehicleRepository = new PostgresVehicleRepository(deps.db);
  const realtimeGateway = new RealtimeGateway(app.log);
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

  return { app, vehicleRepository };
}
