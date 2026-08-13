"use client";

import { useMemo } from "react";
import L from "leaflet";
import { Marker } from "react-leaflet";
import type { VehicleSnapshot } from "@repo/contracts";
import "./vehicle-marker.css";

function buildVehicleIcon(
  connectivity: VehicleSnapshot["connectivity"],
  isSelected: boolean,
) {
  const classNames = ["vehicleMarker"];
  if (isSelected) classNames.push("vehicleMarkerSelected");

  return L.divIcon({
    className: "",
    html: `<span class="${classNames.join(" ")}" data-connectivity="${connectivity ?? "unknown"}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function VehicleMarker({
  vehicle,
  isSelected,
  onSelect,
}: {
  vehicle: VehicleSnapshot & { latitude: number; longitude: number };
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const icon = useMemo(
    () => buildVehicleIcon(vehicle.connectivity, isSelected),
    [vehicle.connectivity, isSelected],
  );

  return (
    <Marker
      position={[vehicle.latitude, vehicle.longitude]}
      icon={icon}
      zIndexOffset={isSelected ? 1000 : 0}
      eventHandlers={{
        click: () => onSelect(vehicle.id),
      }}
    />
  );
}
