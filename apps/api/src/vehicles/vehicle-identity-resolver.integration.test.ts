import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { env } from "../env.js";
import { PostgresVehicleIdentityResolver } from "./vehicle-identity-resolver.js";

// Requires a real Postgres reachable at DATABASE_URL with migrations
// applied: `docker compose up -d postgres && npm run migrate --workspace=api -- up`.
describe("PostgresVehicleIdentityResolver", () => {
  const db = new Pool({ connectionString: env.databaseUrl });
  const resolver = new PostgresVehicleIdentityResolver(db);

  afterAll(async () => {
    await db.end();
  });

  afterEach(async () => {
    await db.query("DELETE FROM vehicle_identities");
  });

  it("mints a new canonical id for a provider ref it hasn't seen before", async () => {
    const id = await resolver.resolve("opensky", "abc123");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("resolves the same (source, providerRef) to the same canonical id every time", async () => {
    const first = await resolver.resolve("opensky", "abc123");
    const second = await resolver.resolve("opensky", "abc123");
    expect(second).toBe(first);
  });

  it("gives distinct providerRefs within the same source distinct canonical ids", async () => {
    const a = await resolver.resolve("opensky", "abc123");
    const b = await resolver.resolve("opensky", "def456");
    expect(a).not.toBe(b);
  });

  it("keeps identical providerRefs from different sources separate unless a mapping unifies them", async () => {
    // No cross-source unification exists yet by default — two different
    // sources reporting the same raw string get distinct canonical ids
    // until something (a future static mapping) says otherwise.
    const opensky = await resolver.resolve("opensky", "vehicle-001");
    const mqtt = await resolver.resolve("mqtt", "vehicle-001");
    expect(opensky).not.toBe(mqtt);
  });
});
