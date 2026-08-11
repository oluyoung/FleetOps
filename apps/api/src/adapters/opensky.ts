import crypto from "node:crypto";
import { z } from "zod";
import { CanonicalTelemetryEventSchema } from "@repo/contracts";
import type { CanonicalTelemetryEvent } from "@repo/contracts";
import type { ProviderAdapter } from "./provider-adapter.js";

const OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all";

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

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly url: string = OPENSKY_STATES_URL,
    private readonly fleetSize: number = DEFAULT_FLEET_SIZE,
  ) {}

  async poll(): Promise<CanonicalTelemetryEvent[]> {
    const response = await this.fetchFn(this.url);
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
}
