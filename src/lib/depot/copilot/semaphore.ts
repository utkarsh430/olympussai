import { CopilotFailure } from '@/lib/depot/copilot/types';

export interface Semaphore {
  /** `signal` lets a queued waiter leave the queue: it then rejects with `aborted`. */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

const aborted = (): CopilotFailure => new CopilotFailure('aborted', 'left the queue');

/**
 * Caps concurrent tasks at `limit` and waiters at `maxQueue`. Beyond that it
 * rejects at once with `busy`, so load turns into scripted responses rather
 * than an unbounded queue of child processes. A waiter whose caller has gone
 * (deadline or disconnect) leaves the queue at once, so it neither holds a
 * queue place nor starts work, and spends no budget, after nobody is waiting.
 */
export function createSemaphore(limit: number, maxQueue: number): Semaphore {
  let active = 0;
  let waiting: ReadonlyArray<() => void> = [];

  const release = (): void => {
    const [next, ...rest] = waiting;
    waiting = rest;
    if (next) next();
    else active -= 1;
  };

  /** Resolves when release() hands over a slot; rejects if the signal aborts first. */
  function enqueue(signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        waiting = waiting.filter((w) => w !== wake);
        reject(aborted());
      };
      const wake = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      waiting = [...waiting, wake];
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  return {
    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) throw aborted();
      if (active < limit) {
        active += 1;
      } else if (waiting.length < maxQueue) {
        // The slot is handed over by release(), so `active` stays unchanged.
        await enqueue(signal);
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
