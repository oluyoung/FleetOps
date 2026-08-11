import pino from "pino";
import type { FastifyBaseLogger } from "fastify";

/**
 * One Pino instance shared by Fastify (via `loggerInstance`) and the
 * non-Fastify-owned parts of the pipeline (event bus, ingestion loops,
 * realtime gateway) that run outside a request context, per ADR-012.
 *
 * Reads LOG_LEVEL directly rather than importing `env.js`: that module
 * eagerly validates the full environment (including DATABASE_URL), which
 * would drag a database requirement into every unit test that merely
 * imports something that logs, e.g. InMemoryEventBus.
 *
 * Typed as FastifyBaseLogger (not the more specific pino.Logger returned by
 * `pino()`) so passing it to `Fastify({ loggerInstance })` doesn't narrow
 * FastifyInstance's logger generic away from the plain FastifyInstance type
 * used everywhere else in this codebase.
 */
export const logger: FastifyBaseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});
