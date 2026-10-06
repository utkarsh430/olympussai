/** Process-group killing for the CLI child, kept apart from `run.ts` so each stays small. */

/** The part of a child process this file needs. */
export interface KillableChild {
  readonly pid?: number;
  kill(signal?: 'SIGKILL'): unknown;
}

export type KillGroup = (pid: number) => void;

/**
 * SIGKILL to the child's whole process group (the child is spawned detached).
 * Node never gives a child pid 0 or 1, but `-0` would be the server's own group
 * and `-1` every process the user owns, so anything but a pid above 1 sends
 * nothing (review L1).
 */
export const killProcessGroup: KillGroup = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  process.kill(-pid, 'SIGKILL');
};

/**
 * How long a call waits for the child's `close` after the group was killed.
 * SIGKILL cannot be caught, so close normally follows within milliseconds; the
 * wait is bounded so a stuck pipe cannot hold the slot, and the reason says so.
 */
export const CLI_CLOSE_GRACE_MS = 2_000;

export const errorCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

const killQuietly = (child: KillableChild): void => {
  try {
    child.kill('SIGKILL');
  } catch {
    // Nothing left to signal.
  }
};

/**
 * Kills the child's whole group. A group that is already gone (ESRCH) is the
 * normal case after a clean exit and is ignored; any other failure falls back to
 * the child itself. A child with no pid never started, so it has no group.
 *
 * Accepted residual (review L2): on a clean exit this runs after `close`, so
 * after Node reaped the leader. If no group member survives, the pgid is free,
 * and in theory a new process could take that pid and lead a group of its own
 * in the few event-loop turns before this kill. While any grandchild survives,
 * POSIX keeps the pgid reserved and the kill is correct. Pids are allocated in
 * order on macOS, so the window is negligible; no kill is ever sent after the
 * grace period has resolved the call, and none without a pid.
 */
export function killChildGroup(
  child: KillableChild,
  killGroup: KillGroup,
  closed: boolean,
): void {
  if (child.pid === undefined) {
    if (!closed) killQuietly(child);
    return;
  }
  try {
    killGroup(child.pid);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ESRCH') killQuietly(child);
  }
}
