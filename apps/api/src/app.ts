import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { EventBus } from "./event-bus/event-bus.js";
import type { DomainEvent } from "./event-bus/domain-events.js";
import { PostgresVehicleRepository } from "./vehicles/vehicle-repository.js";
import { registerVehicleStateSubscriber } from "./vehicles/vehicle-state-subscriber.js";

export function buildApp(deps: {
  db: Pool;
  eventBus: EventBus<DomainEvent>;
}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  const vehicleRepository = new PostgresVehicleRepository(deps.db);
  registerVehicleStateSubscriber(deps.eventBus, vehicleRepository);

  app.get("/health", async () => {
    await deps.db.query("SELECT 1");
    return { status: "ok" };
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error({ err: error }, "unhandled request error");
    reply.status(error.statusCode ?? 500).send({
      error: error.name,
      message: error.message,
    });
  });

  return app;
}
