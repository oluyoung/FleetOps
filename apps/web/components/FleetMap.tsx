"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { VehicleSnapshot } from "@repo/contracts";
import { useFleet } from "../lib/use-fleet";
import { VehicleMarker } from "./VehicleMarker";
import styles from "./FleetMap.module.css";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278];
const DEFAULT_ZOOM = 4;

type PositionedVehicle = VehicleSnapshot & { latitude: number; longitude: number };

function hasPosition(vehicle: VehicleSnapshot): vehicle is PositionedVehicle {
  return vehicle.latitude !== null && vehicle.longitude !== null;
}

function FitBoundsOnce({ vehicles }: { vehicles: PositionedVehicle[] }) {
  const map = useMap();
  const hasFitRef = useRef(false);

  useEffect(() => {
    if (hasFitRef.current || vehicles.length === 0) return;
    hasFitRef.current = true;
    map.fitBounds(
      vehicles.map((vehicle) => [vehicle.latitude, vehicle.longitude]),
      { padding: [32, 32], maxZoom: 10 },
    );
  }, [map, vehicles]);

  return null;
}

export default function FleetMap({
  selectedVehicleId,
  onSelectVehicle,
}: {
  selectedVehicleId: string | null;
  onSelectVehicle: (id: string) => void;
}) {
  const { data: vehicles } = useFleet();
  const positioned = (vehicles ?? []).filter(hasPosition);

  return (
    <div className={styles.mapContainer}>
      <MapContainer
        className={styles.map}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBoundsOnce vehicles={positioned} />
        {positioned.map((vehicle) => (
          <VehicleMarker
            key={vehicle.id}
            vehicle={vehicle}
            isSelected={vehicle.id === selectedVehicleId}
            onSelect={onSelectVehicle}
          />
        ))}
      </MapContainer>
    </div>
  );
}
