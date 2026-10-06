import { formatNumber } from '@/lib/formatters';

const DASH = '—';
const RUPEE = '₹';

/** Whole rupees with Indian digit grouping (12,34,567); a dash for a value that is not a number. */
export function formatRupees(rupees: number): string {
  if (!Number.isFinite(rupees)) return DASH;
  return `${RUPEE}${formatNumber(Math.round(rupees))}`;
}
