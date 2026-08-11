# ADR: Long-Running Containerised Backend

## Status
Accepted

## Context

FleetOps has two backend workloads that do not fit short-lived serverless execution well:

- persistent WebSocket connections;
- continuous telemetry ingestion from HTTP and MQTT providers.

The backend also needs to remain portable so the initial demo deployment can move to more production-oriented infrastructure later without rewriting application code.

## Decision

Run the Fastify backend as a long-running Docker container.

Initial deployment:

```text
Next.js → Vercel

Fastify container → Fly.io or Render

PostgreSQL → Supaabse
```

The backend container owns:

- REST APIs;
- WebSocket connections;
- telemetry ingestion loops;
- provider adapters;
- event processing.

After the application is stable, the same containerised backend can move to:

```text
AWS ALB
   ↓
ECS / Fargate
   ↓
RDS PostgreSQL
```

The application should avoid provider-specific deployment APIs so the runtime remains portable.

## Why

This supports the workload naturally while keeping deployment simple during the demo phase.

It also creates a clear evolution path from:

> fast iteration

to:

> controlled production infrastructure

without changing the application architecture.

## Alternatives

**Serverless functions** — rejected because long-lived WebSocket connections and continuous ingestion workers are a poor fit.

**AWS from day one** — viable but introduces unnecessary infrastructure work before the product behaviour is stable.

## Trade-offs

A long-running container requires process health monitoring and lifecycle management.

The initial Fly.io/Render environment will not exactly match the later ECS/Fargate topology.

## Revisit When

Move to ECS/Fargate when:

- the application architecture is stable;
- multiple backend replicas are required;
- networking, scaling and deployment controls need to be more explicit;
- AWS-native observability and infrastructure become valuable.