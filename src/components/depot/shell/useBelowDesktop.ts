'use client';

import { BREAKPOINT_PX } from '@/lib/depot/shell/geometry';
import { useWidthTier, type WidthTiers } from './useWidthTier';

/** From 1024 a table has room for every column; below it, its narrower set. */
const DESKTOP_TIERS: WidthTiers<'desktop' | 'below'> = [
  ['desktop', BREAKPOINT_PX.lg],
  ['below', 0],
];

/** From 640 a table shows more than its phone column set. */
const PHONE_TIERS: WidthTiers<'above' | 'phone'> = [
  ['above', BREAKPOINT_PX.sm],
  ['phone', 0],
];

/** True below 1024px. False on the server, so the server render and the first paint agree. */
export function useBelowDesktop(): boolean {
  return useWidthTier(DESKTOP_TIERS) === 'below';
}

/** True below 640px. False on the server, so the server render and the first paint agree. */
export function usePhone(): boolean {
  return useWidthTier(PHONE_TIERS) === 'phone';
}
