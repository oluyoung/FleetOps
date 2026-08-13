export function formatCoordinate(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

export function formatNumber(value: number | null, unit: string): string {
  return value === null ? "—" : `${Math.round(value)} ${unit}`;
}

export function formatLastSeen(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}
