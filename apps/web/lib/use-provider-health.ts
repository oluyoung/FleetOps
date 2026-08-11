"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchProviderHealth } from "./api";

// Provider health isn't pushed over the WebSocket (it's a derived summary,
// not a domain event per RFC-002) — polling on a plain interval is enough
// for an operational dashboard.
const REFETCH_INTERVAL_MS = 5000;

export function useProviderHealth() {
  return useQuery({
    queryKey: ["provider-health"],
    queryFn: fetchProviderHealth,
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}
