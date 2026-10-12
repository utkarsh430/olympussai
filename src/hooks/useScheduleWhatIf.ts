'use client';

import { useCallback, useRef, useState } from 'react';
import { isValidDepotId } from '@/lib/depot/ids';
import type { ScheduleResponse } from '@/lib/depot/schedule/api';
import type { ScheduleParams } from '@/lib/depot/schedule/types';

export interface ScheduleWhatIf {
  readonly data: ScheduleResponse | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly run: (params: ScheduleParams) => void;
  readonly reset: () => void;
}

const MESSAGES: Readonly<Record<number, string>> = {
  429: 'Too many what-ifs in a minute; try again shortly.',
  400: 'The what-if could not be read.',
};

/** Asks the server for the depot's plan under a what-if; the latest answer wins. */
export function useScheduleWhatIf(depotId: string | null): ScheduleWhatIf {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const run = useCallback(
    (params: ScheduleParams) => {
      if (!isValidDepotId(depotId)) return;
      const ticket = latest.current + 1;
      latest.current = ticket;
      setBusy(true);
      setError(null);
      fetch(`/api/upsrtc/depot/${encodeURIComponent(depotId)}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        credentials: 'same-origin',
      })
        .then(async (res) => {
          if (ticket !== latest.current) return;
          if (!res.ok) {
            setError(MESSAGES[res.status] ?? 'The what-if did not answer.');
            return;
          }
          setData((await res.json()) as ScheduleResponse);
        })
        .catch(() => {
          if (ticket === latest.current) setError('The what-if did not answer.');
        })
        .finally(() => {
          if (ticket === latest.current) setBusy(false);
        });
    },
    [depotId],
  );

  const reset = useCallback(() => {
    latest.current += 1;
    setData(null);
    setError(null);
    setBusy(false);
  }, []);

  return { data, error, busy, run, reset };
}
