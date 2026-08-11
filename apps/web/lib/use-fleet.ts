"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RealtimeEventSchema, VehicleSnapshotSchema } from "@repo/contracts";
import { fetchVehicles, WS_URL } from "./api";

export const VEHICLES_QUERY_KEY = ["vehicles"] as const;

const VehicleRealtimeEventSchema = RealtimeEventSchema(VehicleSnapshotSchema);

const MIN_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 15_000;

export type ConnectionStatus = "connecting" | "open" | "closed";

/**
 * REST snapshot is the source of truth on load/reconnect (ADR-003); the
 * WebSocket only applies incremental `vehicle.updated` deltas onto the same
 * TanStack Query cache in between (RFC-002 "one client cache, not two").
 */
export function useFleet() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  const query = useQuery({
    queryKey: VEHICLES_QUERY_KEY,
    queryFn: fetchVehicles,
  });

  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectDelay = MIN_RECONNECT_DELAY_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let isReconnect = false;

    function connect() {
      if (stopped) return;
      setStatus("connecting");
      // Server-side websocket_reconnect_total (ADR-012) can't tell a
      // reconnect from a first connect on its own — the client declares it.
      socket = new WebSocket(isReconnect ? `${WS_URL}?reconnect=true` : WS_URL);
      isReconnect = true;

      socket.addEventListener("open", () => {
        reconnectDelay = MIN_RECONNECT_DELAY_MS;
        setStatus("open");
        // Re-sync from REST on (re)connect in case updates were missed while
        // disconnected.
        void refetchRef.current();
      });

      socket.addEventListener("message", (message) => {
        const parsed = VehicleRealtimeEventSchema.safeParse(
          JSON.parse(message.data as string),
        );
        if (!parsed.success) return;

        const event = parsed.data;
        if (event.type !== "vehicle.updated") return;

        queryClient.setQueryData(
          VEHICLES_QUERY_KEY,
          (current: typeof event.payload[] | undefined) => {
            if (!current) return current;
            const index = current.findIndex((v) => v.id === event.payload.id);
            if (index === -1) return [...current, event.payload];
            const next = current.slice();
            next[index] = event.payload;
            return next;
          },
        );
      });

      socket.addEventListener("close", () => {
        if (stopped) return;
        setStatus("closed");
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      });

      socket.addEventListener("error", () => {
        socket?.close();
      });
    }

    connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient]);

  return { ...query, connectionStatus: status };
}
