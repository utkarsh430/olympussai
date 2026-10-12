'use client';

import { useEffect, useState } from 'react';
import type { SchedulerRollupResponse } from '@/lib/depot/schedule/api';
import { DEFAULT_POLL_INTERVAL_MS, usePolledJson, type PolledState } from '@/hooks/usePolledJson';

/** While depots are still being planned the page asks again every few seconds. */
const FILLING_INTERVAL_MS = 4_000;

export type SchedulerRollupState = PolledState<SchedulerRollupResponse>;

export function useSchedulerRollup(): SchedulerRollupState {
  const [filling, setFilling] = useState(false);
  const state = usePolledJson<SchedulerRollupResponse>('/api/upsrtc/depot/scheduler', {
    intervalMs: filling ? FILLING_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS,
  });
  const pending = state.data?.pending ?? 0;
  useEffect(() => {
    setFilling(pending > 0);
  }, [pending]);
  return state;
}
