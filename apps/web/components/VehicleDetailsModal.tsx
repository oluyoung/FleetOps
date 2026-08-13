"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { VehicleSnapshot } from "@repo/contracts";
import { formatCoordinate, formatLastSeen, formatNumber } from "../lib/format";
import styles from "./VehicleDetailsModal.module.css";

// Text-only content throughout this file — no svg/icon-font/emoji glyphs.
export function VehicleDetailsModal({
  vehicle,
  onClose,
}: {
  vehicle: VehicleSnapshot | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!vehicle) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [vehicle, onClose]);

  if (!vehicle) return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <h2>{vehicle.id}</h2>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Close
          </button>
        </div>
        <dl className={styles.details}>
          <dt>Position</dt>
          <dd>
            {formatCoordinate(vehicle.latitude)}, {formatCoordinate(vehicle.longitude)}
          </dd>

          <dt>Altitude</dt>
          <dd>{formatNumber(vehicle.altitudeMeters, "m")}</dd>

          <dt>Speed</dt>
          <dd>{formatNumber(vehicle.speedMps, "m/s")}</dd>

          <dt>Heading</dt>
          <dd>{formatNumber(vehicle.headingDegrees, "°")}</dd>

          <dt>Battery</dt>
          <dd>{formatNumber(vehicle.batteryPercent, "%")}</dd>

          <dt>Connectivity</dt>
          <dd>{vehicle.connectivity ?? "unknown"}</dd>

          <dt>Last seen source</dt>
          <dd>{vehicle.lastSeenSource ?? "unknown"}</dd>

          <dt>Last updated</dt>
          <dd>{formatLastSeen(vehicle.lastUpdatedAt)}</dd>

          <dt>Ambient temperature</dt>
          <dd>{formatNumber(vehicle.ambientTemperatureC, "°C")}</dd>

          <dt>Wind speed</dt>
          <dd>{formatNumber(vehicle.windSpeedMps, "m/s")}</dd>

          <dt>Weather updated</dt>
          <dd>{vehicle.weatherUpdatedAt ? formatLastSeen(vehicle.weatherUpdatedAt) : "—"}</dd>
        </dl>
      </div>
    </div>,
    document.body,
  );
}
