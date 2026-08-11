import crypto from "node:crypto";
import { z } from "zod";
import { CanonicalTelemetryEventSchema } from "@repo/contracts";
import type { CanonicalTelemetryEvent, VehicleSnapshot } from "@repo/contracts";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { VehicleRepository } from "../vehicles/vehicle-repository.js";
import { telemetryEventsRejectedTotal } from "../observability/metrics.js";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// Round to ~1km resolution so vehicles clustered nearby share one Open-Meteo
// location and one batched request, instead of one HTTP call per vehicle.
const COORDINATE_PRECISION = 2;

function roundCoordinate(value: number): number {
  return Number(value.toFixed(COORDINATE_PRECISION));
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  vehicleIds: string[];
}

/**
 * Groups current vehicle positions by rounded lat/lon so Open-Meteo's
 * batched forecast endpoint (comma-separated latitude/longitude lists) is
 * called once per poll rather than once per vehicle. Vehicles with no known
 * position yet (no primary telemetry seen) have nothing to enrich.
 */
export function groupVehiclesByLocation(
  vehicles: VehicleSnapshot[],
): WeatherLocation[] {
  const byKey = new Map<string, WeatherLocation>();
  for (const vehicle of vehicles) {
    if (vehicle.latitude === null || vehicle.longitude === null) continue;
    const latitude = roundCoordinate(vehicle.latitude);
    const longitude = roundCoordinate(vehicle.longitude);
    const key = `${latitude},${longitude}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.vehicleIds.push(vehicle.id);
    } else {
      byKey.set(key, { latitude, longitude, vehicleIds: [vehicle.id] });
    }
  }
  return [...byKey.values()];
}

const currentWeatherSchema = z.object({
  time: z.string(),
  temperature_2m: z.number().optional(),
  wind_speed_10m: z.number().optional(),
});

const forecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  current: currentWeatherSchema.optional(),
});
type ForecastResponse = z.infer<typeof forecastResponseSchema>;

// Open-Meteo returns a single object when one location is requested and an
// array when multiple are — normalise to an array either way.
const openMeteoResponseSchema = z.union([
  forecastResponseSchema,
  z.array(forecastResponseSchema),
]);

/**
 * Maps one Open-Meteo forecast result to one CanonicalTelemetryEvent per
 * vehicle at that location. Returns [] when the forecast carries neither
 * field FleetOps enriches with (RFC-001: incomplete payloads are rejected
 * before they reach the domain) rather than publishing an empty-telemetry
 * event.
 */
export function mapForecastToEvents(
  location: WeatherLocation,
  forecast: ForecastResponse,
): CanonicalTelemetryEvent[] {
  const current = forecast.current;
  if (!current) return [];
  if (
    typeof current.temperature_2m !== "number" &&
    typeof current.wind_speed_10m !== "number"
  ) {
    return [];
  }

  const occurredAt = new Date(`${current.time}Z`).toISOString();
  const receivedAt = new Date().toISOString();

  const events: CanonicalTelemetryEvent[] = [];
  for (const vehicleId of location.vehicleIds) {
    const candidate = {
      eventId: crypto.randomUUID(),
      vehicleId,
      source: "open-meteo" as const,
      occurredAt,
      receivedAt,
      telemetry: {
        ...(typeof current.temperature_2m === "number"
          ? { ambientTemperatureC: current.temperature_2m }
          : {}),
        ...(typeof current.wind_speed_10m === "number"
          ? { windSpeedMps: current.wind_speed_10m }
          : {}),
      },
    };
    const parsed = CanonicalTelemetryEventSchema.safeParse(candidate);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

/**
 * Per ADR-005: enrichment adapter implementing the same ProviderAdapter
 * interface as OpenSky, but sourcing its "what to poll" from current vehicle
 * positions (VehicleRepository) rather than an independent feed — weather
 * enriches vehicles established by primary telemetry, it never creates them.
 */
export class WeatherAdapter implements ProviderAdapter {
  readonly source = "open-meteo" as const;

  constructor(
    private readonly vehicleRepository: Pick<VehicleRepository, "findAll">,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly url: string = OPEN_METEO_URL,
  ) {}

  async poll(): Promise<CanonicalTelemetryEvent[]> {
    const vehicles = await this.vehicleRepository.findAll();
    const locations = groupVehiclesByLocation(vehicles);
    if (locations.length === 0) return [];

    const params = new URLSearchParams({
      latitude: locations.map((location) => location.latitude).join(","),
      longitude: locations.map((location) => location.longitude).join(","),
      current: "temperature_2m,wind_speed_10m",
      wind_speed_unit: "ms",
      timezone: "UTC",
    });

    const response = await this.fetchFn(`${this.url}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(
        `Open-Meteo request failed: ${response.status} ${response.statusText}`,
      );
    }

    const body: unknown = await response.json();
    const parsed = openMeteoResponseSchema.safeParse(body);
    if (!parsed.success) {
      const rejectedCount = locations.reduce(
        (total, location) => total + location.vehicleIds.length,
        0,
      );
      telemetryEventsRejectedTotal.inc({ provider: this.source }, rejectedCount);
      return [];
    }

    // Open-Meteo preserves request order in the response array.
    const forecasts = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

    const events: CanonicalTelemetryEvent[] = [];
    for (let i = 0; i < locations.length; i += 1) {
      const forecast = forecasts[i];
      const location = locations[i];
      if (!forecast || !location) continue;
      const mapped = mapForecastToEvents(location, forecast);
      if (mapped.length === 0 && location.vehicleIds.length > 0) {
        telemetryEventsRejectedTotal.inc(
          { provider: this.source },
          location.vehicleIds.length,
        );
      }
      events.push(...mapped);
    }
    return events;
  }
}
