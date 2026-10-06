'use client';

import { usePhone } from '@/components/depot/shell/useBelowDesktop';

/** True below 640 px, where the board opens as the table. False on the server. */
export function useTableFirst(): boolean {
  return usePhone();
}
