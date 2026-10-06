import type { CopilotText } from '@/lib/depot/copilot/types';

/** What a request gets when its own signal aborts before the shared call settles. */
export const LEFT = Symbol('left');

export interface InflightCalls {
  /** True while a call for `key` is running. */
  has(key: string): boolean;
  /**
   * Waits for the call for `key`, starting it with `start` if none is running.
   * Resolves to LEFT as soon as `signal` aborts. The call itself is aborted
   * only when every request waiting on it has left.
   */
  join(
    key: string,
    start: (signal: AbortSignal) => Promise<CopilotText>,
    signal: AbortSignal,
  ): Promise<CopilotText | typeof LEFT>;
}

interface Call {
  readonly promise: Promise<CopilotText>;
  readonly controller: AbortController;
  readonly members: number;
}

/**
 * One Claude call per cache key at a time: concurrent requests for the same
 * task and facts share it instead of each spending a slot and a call. The map
 * holds only running calls, so its size is bounded by the requests in flight.
 */
export function createInflightCalls(): InflightCalls {
  const calls = new Map<string, Call>();

  function startCall(key: string, start: (signal: AbortSignal) => Promise<CopilotText>): Call {
    const controller = new AbortController();
    const promise = start(controller.signal).finally(() => {
      if (calls.get(key)?.controller === controller) calls.delete(key);
    });
    // The joiners below observe it; this keeps an unobserved rejection quiet.
    promise.catch(() => undefined);
    return { promise, controller, members: 0 };
  }

  function leave(key: string, controller: AbortController): void {
    const call = calls.get(key);
    if (call?.controller !== controller) return;
    if (call.members > 1) {
      calls.set(key, { ...call, members: call.members - 1 });
      return;
    }
    calls.delete(key);
    controller.abort();
  }

  return {
    has: (key) => calls.has(key),
    join(key, start, signal) {
      const existing = calls.get(key) ?? startCall(key, start);
      const call = { ...existing, members: existing.members + 1 };
      calls.set(key, call);
      return new Promise<CopilotText | typeof LEFT>((resolve, reject) => {
        const onAbort = (): void => {
          leave(key, call.controller);
          resolve(LEFT);
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        call.promise.then(
          (text) => {
            signal.removeEventListener('abort', onAbort);
            resolve(text);
          },
          (error: unknown) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
          },
        );
      });
    },
  };
}
