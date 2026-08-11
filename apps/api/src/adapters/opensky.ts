import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CanonicalTelemetryEventSchema } from "@repo/contracts";
import type { CanonicalTelemetryEvent } from "@repo/contracts";
import type { ProviderAdapter } from "./provider-adapter.js";

const OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all";
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

export interface OpenSkyCredentials {
  clientId: string;
  clientSecret: string;
}

const credentialsFileSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const DEFAULT_CREDENTIALS_FILE = fileURLToPath(
  new URL("../../../web/credentials.json", import.meta.url),
);

/**
 * Reads OAuth2 client-credentials from apps/web/credentials.json. Returns
 * undefined (rather than throwing) when the file is absent, so local dev
 * without it still runs — just against OpenSky's rate-limited anonymous
 * endpoint.
 */
export function loadOpenSkyCredentials(
  path: string = DEFAULT_CREDENTIALS_FILE,
): OpenSkyCredentials | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  return credentialsFileSchema.parse(JSON.parse(raw));
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

/**
 * Caches an OpenSky OAuth2 client-credentials token and refreshes it a
 * little before expiry. Authenticated requests get a much higher rate limit
 * than the anonymous endpoint, which 429s aggressively under normal polling.
 */
class OpenSkyTokenProvider {
  private accessToken: string | null = null;
  private expiresAtMs = 0;

  constructor(
    private readonly credentials: OpenSkyCredentials,
    private readonly fetchFn: typeof fetch,
  ) {}

  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAtMs) {
      return this.accessToken;
    }

    const response = await this.fetchFn(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenSky token request failed: ${response.status} ${response.statusText}`,
      );
    }

    const body: unknown = await response.json();
    const parsed = tokenResponseSchema.parse(body);

    this.accessToken = parsed.access_token;
    // Refresh 30s early so an in-flight poll never races token expiry.
    this.expiresAtMs = Date.now() + Math.max(parsed.expires_in - 30, 0) * 1000;
    return this.accessToken;
  }

  invalidate(): void {
    this.accessToken = null;
    this.expiresAtMs = 0;
  }
}

// https://openskynetwork.github.io/opensky-api/rest.html#response
const openSkyResponseSchema = z.object({
  time: z.number(),
  states: z.array(z.array(z.unknown())).nullable(),
});

/**
 * Maps one OpenSky state vector to a CanonicalTelemetryEvent. Returns null
 * for vectors missing the fields FleetOps needs (e.g. no position fix) —
 * per RFC-001, malformed/incomplete payloads are rejected before they reach
 * the domain rather than propagated as partial events.
 */
export function mapStateVectorToEvent(
  vector: unknown[],
): CanonicalTelemetryEvent | null {
  const icao24 = vector[0];
  const timePosition = vector[3];
  const lastContact = vector[4];
  const longitude = vector[5];
  const latitude = vector[6];
  const baroAltitude = vector[7];
  const velocity = vector[9];
  const trueTrack = vector[10];

  if (typeof icao24 !== "string" || icao24.trim() === "") return null;
  if (typeof latitude !== "number" || typeof longitude !== "number")
    return null;

  const occurredAtSeconds =
    typeof timePosition === "number"
      ? timePosition
      : typeof lastContact === "number"
        ? lastContact
        : null;
  if (occurredAtSeconds === null) return null;

  const candidate = {
    eventId: crypto.randomUUID(),
    vehicleId: `opensky-${icao24}`,
    source: "opensky" as const,
    occurredAt: new Date(occurredAtSeconds * 1000).toISOString(),
    receivedAt: new Date().toISOString(),
    telemetry: {
      latitude,
      longitude,
      ...(typeof baroAltitude === "number"
        ? { altitudeMeters: baroAltitude }
        : {}),
      ...(typeof velocity === "number" && velocity >= 0
        ? { speedMps: velocity }
        : {}),
      ...(typeof trueTrack === "number"
        ? { headingDegrees: trueTrack }
        : {}),
    },
  };

  const parsed = CanonicalTelemetryEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const DEFAULT_FLEET_SIZE = 15;

export class OpenSkyAdapter implements ProviderAdapter {
  readonly source = "opensky" as const;

  // OpenSky's public /states/all is a global feed (~9-10k aircraft) with no
  // per-request filter that reliably yields a small, stable set — a bounding
  // box still returns a varying count as aircraft enter/leave the region.
  // FleetOps is a fleet dashboard, not a global tracker, so on the first
  // successful poll we pin a fixed-size set of vehicleIds (sorted for
  // determinism) and only ever report on that set afterwards. A vehicle
  // that drops out of a later poll just stops updating — its last known
  // state stands — rather than being replaced by a different aircraft.
  private fleetVehicleIds: ReadonlySet<string> | null = null;
  private readonly tokenProvider: OpenSkyTokenProvider | null;

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly url: string = OPENSKY_STATES_URL,
    private readonly fleetSize: number = DEFAULT_FLEET_SIZE,
    credentials?: OpenSkyCredentials,
  ) {
    this.tokenProvider = credentials
      ? new OpenSkyTokenProvider(credentials, fetchFn)
      : null;
  }

  async poll(): Promise<CanonicalTelemetryEvent[]> {
    const response = await this.fetchStates();
    if (!response.ok) {
      throw new Error(
        `OpenSky request failed: ${response.status} ${response.statusText}`,
      );
    }

    const body: unknown = await response.json();
    const parsed = openSkyResponseSchema.safeParse(body);
    if (!parsed.success || !parsed.data.states) return [];

    const events: CanonicalTelemetryEvent[] = [];
    for (const vector of parsed.data.states) {
      const event = mapStateVectorToEvent(vector);
      if (event) events.push(event);
    }

    if (!this.fleetVehicleIds) {
      this.fleetVehicleIds = new Set(
        events
          .map((event) => event.vehicleId)
          .sort()
          .slice(0, this.fleetSize),
      );
    }

    return events.filter((event) => this.fleetVehicleIds?.has(event.vehicleId));
  }

  // A 401 here means the cached token expired early (clock skew, or the
  // server invalidated it) — the tutorial's guidance is to fetch a fresh
  // token and retry once rather than treating it as a hard failure.
  private async fetchStates(): Promise<Response> {
    const first = await this.fetchStatesWithToken();
    if (first.status !== 401 || !this.tokenProvider) return first;

    this.tokenProvider.invalidate();
    return this.fetchStatesWithToken();
  }

  private async fetchStatesWithToken(): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.tokenProvider) {
      headers.Authorization = `Bearer ${await this.tokenProvider.getToken()}`;
    }
    return this.fetchFn(this.url, { headers });
  }
}
