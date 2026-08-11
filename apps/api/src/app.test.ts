import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { buildApp } from "./app.js";

function fakePool(): Pool {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
}

describe("GET /health", () => {
  it("returns ok when the database responds", async () => {
    const app = buildApp({ db: fakePool() });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
