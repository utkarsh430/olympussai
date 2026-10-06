import { CopilotFailure } from '@/lib/depot/copilot/types';

export interface Semaphore {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * Caps concurrent tasks at `limit` and waiters at `maxQueue`. Beyond that it
 * rejects at once with `busy`, so load turns into scripted responses rather
 * than an unbounded queue of child processes.
 */
export function createSemaphore(limit: number, maxQueue: number): Semaphore {
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < limit) {
        active += 1;
      } else if (waiting.length < maxQueue) {
        // The slot is handed over by release(), so `active` stays unchanged.
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        throw new CopilotFailure('busy', 'copilot is at capacity');
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
