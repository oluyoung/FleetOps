import type { CanonicalTelemetryEvent } from "@repo/contracts";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { VehicleIdentityResolver } from "../vehicles/vehicle-identity-resolver.js";

/**
 * Wraps an identity-establishing adapter (OpenSky, MQTT) and rewrites each
 * event's vehicleId from the adapter's raw provider-namespaced id (e.g.
 * "opensky-abc123") to the FleetOps-owned canonical id from
 * VehicleIdentityResolver — per Step 13/ADR-005, so the same real-world
 * vehicle converges on one `vehicles` row no matter which provider reported
 * it, instead of one row per provider's own id format.
 *
 * Never wrap an enrichment adapter (Open-Meteo) with this: enrichment events
 * already carry an existing canonical vehicleId, and resolving that again
 * would mint a spurious second identity for it.
 */
export class IdentityResolvingAdapter implements ProviderAdapter {
  readonly source: ProviderAdapter["source"];

  constructor(
    private readonly inner: ProviderAdapter,
    private readonly resolver: VehicleIdentityResolver,
  ) {
    this.source = inner.source;
  }

  async poll(): Promise<CanonicalTelemetryEvent[]> {
    const events = await this.inner.poll();
    return Promise.all(
      events.map(async (event) => ({
        ...event,
        vehicleId: await this.resolver.resolve(event.source, event.vehicleId),
      })),
    );
  }
}
