const DASH = '—';
const RUPEE = '₹';
const LAST_GROUP = /(\d+?)(?=(\d\d)+(\d)(?!\d))/g;

/**
 * Indian grouping (last three digits, then pairs) done here, not through the
 * runtime's locale data, so every server prints the same string.
 */
function groupIndian(digits: string): string {
  return digits.replace(LAST_GROUP, '$1,');
}

/**
 * Whole rupees as "₹12,34,567". The absolute value is rounded first, so a
 * value that rounds to zero never prints a sign; a negative amount puts the
 * sign before the symbol ("-₹1,234"). A non-finite value gives a dash.
 */
export function formatRupees(rupees: number): string {
  if (!Number.isFinite(rupees)) return DASH;
  const whole = Math.round(Math.abs(rupees));
  const sign = rupees < 0 && whole > 0 ? '-' : '';
  return `${sign}${RUPEE}${groupIndian(BigInt(whole).toString())}`;
}
