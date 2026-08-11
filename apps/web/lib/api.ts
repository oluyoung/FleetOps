import { VehicleSnapshotSchema, type VehicleSnapshot } from "@repo/contracts";
import { z } from "zod";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws";

export async function fetchVehicles(): Promise<VehicleSnapshot[]> {
  const response = await fetch(`${API_URL}/vehicles`);
  if (!response.ok) {
    throw new Error(`GET /vehicles failed: ${response.status}`);
  }
  return z.array(VehicleSnapshotSchema).parse(await response.json());
}
