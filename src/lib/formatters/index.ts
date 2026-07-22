import type { DataQuality } from '@/models/canonical';

export function formatIndiaTime(value: Date | string | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatIndiaDateTime(value: Date | string | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** "12s ago" / "4m ago" / "2h ago" — compact relative age. */
export function formatRelativeAge(value: string | null, now: number = Date.now()): string {
  if (!value) return 'no signal';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'unknown';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatSpeed(speedKmph: number | null): string {
  if (speedKmph === null) return '— km/h';
  return `${speedKmph.toFixed(0)} km/h`;
}

export function formatCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function formatHeading(headingDegrees: number | null): string {
  if (headingDegrees === null) return '—';
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(headingDegrees / 45) % 8;
  return `${headingDegrees.toFixed(0)}° ${compass[index] ?? 'N'}`;
}

/** Upstream emits "10:06:00"; render as "10:06". Pass ISO through Intl. */
export function formatScheduleTime(value: string | null): string {
  if (!value) return '—';
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatIndiaTime(date).slice(0, 5);
}

export const DATA_QUALITY_META: Record<
  DataQuality,
  { label: string; description: string; className: string; dot: string }
> = {
  good: {
    label: 'GOOD',
    description: 'GPS fix received within the last 5 minutes',
    className: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10',
    dot: 'bg-emerald-400',
  },
  degraded: {
    label: 'DEGRADED',
    description: 'GPS fix between 5 and 30 minutes old',
    className: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
    dot: 'bg-amber-400',
  },
  stale: {
    label: 'STALE',
    description: 'No GPS fix in the last 30 minutes',
    className: 'text-rose-300 border-rose-400/40 bg-rose-500/10',
    dot: 'bg-rose-400',
  },
};

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function formatSignedPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${value}%`;
}
