'use client';

import { useEffect, useState } from 'react';
import { formatIndiaTime } from '@/lib/formatters';

/** Ticking Asia/Kolkata clock for the command bar. */
export function useIndiaClock(): string {
  const [time, setTime] = useState('--:--:--');

  useEffect(() => {
    const tick = () => setTime(formatIndiaTime(new Date()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  return time;
}
