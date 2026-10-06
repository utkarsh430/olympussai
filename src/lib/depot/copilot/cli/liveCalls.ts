/**
 * Review L4: the CLI calls in flight, so a server shutdown can end them.
 *
 * `runCli` adds a child's pid when it spawns one and drops it the moment Node
 * reports the child exited (after which the pid may be reused, so it is never
 * signalled again). The CLI provider adds each private folder it makes and drops
 * it once removed. The shutdown handler reads what is left. Only code that
 * started a process or made a folder writes here, so nothing else is targeted.
 */
export interface LiveCalls {
  addPid(pid: number): void;
  dropPid(pid: number): void;
  addDir(dir: string): void;
  dropDir(dir: string): void;
  snapshot(): { readonly pids: readonly number[]; readonly dirs: readonly string[] };
}

export function createLiveCalls(): LiveCalls {
  let pids: ReadonlySet<number> = new Set();
  let dirs: ReadonlySet<string> = new Set();
  const without = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> =>
    new Set([...set].filter((v) => v !== value));
  return {
    addPid: (pid) => {
      pids = new Set([...pids, pid]);
    },
    dropPid: (pid) => {
      pids = without(pids, pid);
    },
    addDir: (dir) => {
      dirs = new Set([...dirs, dir]);
    },
    dropDir: (dir) => {
      dirs = without(dirs, dir);
    },
    snapshot: () => ({ pids: [...pids], dirs: [...dirs] }),
  };
}

const LIVE_CALLS_KEY = Symbol.for('depot.copilot.liveCalls');
type Holder = typeof globalThis & { [LIVE_CALLS_KEY]?: LiveCalls };

/** One registry per process, on `globalThis`, so a hot reload keeps the calls it started. */
export function liveCalls(): LiveCalls {
  const holder = globalThis as Holder;
  const existing = holder[LIVE_CALLS_KEY];
  if (existing) return existing;
  const created = createLiveCalls();
  holder[LIVE_CALLS_KEY] = created;
  return created;
}
