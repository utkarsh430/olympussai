import { formatCount } from '@/lib/depot/format';
import { clockOf } from '@/lib/depot/os/intel/readiness';

/** Rupees the way a depot reads them: lakh and crore past a lakh. */
export function rupees(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} lakh`;
  return `₹${formatCount(Math.round(n))}`;
}

/** The same, short enough for a figure tile. */
export function rupeesShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${formatCount(Math.round(n))}`;
}

export const count = (n: number): string => formatCount(Math.round(n));
export const hours = (n: number): string => `${formatCount(Math.round(n))} h`;
export const km = (n: number): string => `${formatCount(Math.round(n))} km`;
export const pct = (n: number): string => `${Math.round(n * 100)}%`;
export const clock = (min: number): string => clockOf(((min % 1440) + 1440) % 1440);

/** A file of rows for a spreadsheet, offered as a download. */
export function downloadCsv(name: string, header: readonly string[], rows: readonly (readonly (string | number)[])[]): void {
  const cell = (v: string | number): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
