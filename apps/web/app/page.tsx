"use client";

import type { ProviderHealth, VehicleSnapshot } from "@repo/contracts";
import { useFleet } from "../lib/use-fleet";
import { useProviderHealth } from "../lib/use-provider-health";
import styles from "./page.module.css";

function formatCoordinate(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

function formatNumber(value: number | null, unit: string): string {
  return value === null ? "—" : `${Math.round(value)} ${unit}`;
}

function formatLastSeen(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function ProviderHealthBadge({ health }: { health: ProviderHealth }) {
  return (
    <span className={styles.providerBadge} data-status={health.status}>
      {health.provider}
    </span>
  );
}

function VehicleRow({ vehicle }: { vehicle: VehicleSnapshot }) {
  return (
    <tr>
      <td>{vehicle.id}</td>
      <td>
        {formatCoordinate(vehicle.latitude)}, {formatCoordinate(vehicle.longitude)}
      </td>
      <td>{formatNumber(vehicle.speedMps, "m/s")}</td>
      <td>{formatNumber(vehicle.headingDegrees, "°")}</td>
      <td>{vehicle.connectivity ?? "unknown"}</td>
      <td>{formatNumber(vehicle.ambientTemperatureC, "°C")}</td>
      <td>{formatNumber(vehicle.windSpeedMps, "m/s")}</td>
      <td>{formatLastSeen(vehicle.lastUpdatedAt)}</td>
    </tr>
  );
}

export default function Home() {
  const { data: vehicles, isLoading, isError, connectionStatus } = useFleet();
  const { data: providerHealth } = useProviderHealth();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Fleet</h1>
        <span className={styles.status} data-status={connectionStatus}>
          {connectionStatus === "open" ? "live" : connectionStatus}
        </span>
      </header>

      {providerHealth && (
        <div className={styles.providerHealth}>
          {providerHealth.map((health) => (
            <ProviderHealthBadge key={health.provider} health={health} />
          ))}
        </div>
      )}

      {isLoading && <p>Loading fleet…</p>}
      {isError && <p>Failed to load fleet snapshot.</p>}

      {vehicles && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Position</th>
              <th>Speed</th>
              <th>Heading</th>
              <th>Connectivity</th>
              <th>Temp</th>
              <th>Wind</th>
              <th>Last telemetry</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <tr>
                <td colSpan={8}>No vehicles yet.</td>
              </tr>
            ) : (
              vehicles.map((vehicle) => (
                <VehicleRow key={vehicle.id} vehicle={vehicle} />
              ))
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
