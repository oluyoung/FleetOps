import {
  ProviderHealthSchema,
  VehicleSnapshotSchema,
  type ProviderHealth,
  type VehicleSnapshot,
} from "@repo/contracts";
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

export async function fetchProviderHealth(): Promise<ProviderHealth[]> {
  const response = await fetch(`${API_URL}/providers/health`);
  if (!response.ok) {
    throw new Error(`GET /providers/health failed: ${response.status}`);
  }
  const body = z
    .object({ providers: z.array(ProviderHealthSchema) })
    .parse(await response.json());
  return body.providers;
}
