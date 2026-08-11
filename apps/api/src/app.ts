import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Pool } from "pg";

export function buildApp(deps: { db: Pool }): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

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
