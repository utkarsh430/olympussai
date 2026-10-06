import { classifyCliFailure } from '@/lib/depot/copilot/cli/classify';
import { MAX_PROMPT_BYTES } from '@/lib/depot/copilot/limits';
import {
  CLI_CLOSE_GRACE_MS,
  errorCode,
  killChildGroup,
  killProcessGroup,
  type KillGroup,
} from '@/lib/depot/copilot/cli/kill';
import { liveCalls, type LiveCalls } from '@/lib/depot/copilot/cli/liveCalls';
import type { FallbackReason } from '@/lib/depot/copilot/types';

/** Minimal structural views of Node's `child_process.spawn`, so tests can fake it. */
export interface SpawnOptionsLike {
  readonly cwd: string;
  /** Typed as Node's own env so the real `spawn` fits; the value is always an allowlisted record. */
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  /** Own process group, so the whole group can be killed. */
  readonly detached: true;
  readonly stdio: ['pipe', 'pipe', 'pipe'];
  readonly windowsHide: true;
}

interface DataStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface ChildLike {
  readonly pid?: number;
  readonly stdin: {
    write(chunk: string): unknown;
    end(): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
  };
  readonly stdout: DataStream;
  readonly stderr: DataStream;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'exit', listener: () => void): unknown;
  kill(signal?: 'SIGKILL'): unknown;
}

export interface SpawnLike {
  (command: string, args: readonly string[], options: SpawnOptionsLike): ChildLike;
}

export interface RunCliInput {
  readonly bin: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /** Aborting kills the process group and reports `request_rejected`. */
  readonly signal?: AbortSignal;
}

export { CLI_CLOSE_GRACE_MS, killProcessGroup, type KillGroup };

const GRACE_NOTE = '; not closed within the grace period';

export type RunCliResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: FallbackReason; readonly detail: string };

const DETAIL_CHARS = 200;

const isMissingBinary = (error: unknown): boolean => errorCode(error) === 'ENOENT';

const withGraceNote = (result: RunCliResult): RunCliResult =>
  result.ok ? result : { ...result, detail: `${result.detail}${GRACE_NOTE}` };

const failure = (reason: FallbackReason, detail: string): RunCliResult => ({
  ok: false,
  reason,
  detail: detail.slice(0, DETAIL_CHARS),
});

/**
 * Runs the CLI once under hard limits: argument array and no shell, prompt on
 * stdin, a wall-clock timeout and a cap on captured output. The spawn function
 * is a parameter so the trust boundary can be tested without a process.
 */
export function runCli(
  input: RunCliInput,
  spawn: SpawnLike,
  killGroup: KillGroup = killProcessGroup,
  calls: LiveCalls = liveCalls(),
): Promise<RunCliResult> {
  // The child runs detached in its own process group; the whole group is killed
  // on every exit path (see `settle`), so no grandchild outlives the slot.
  // The provider rejects an oversized request before it takes a slot or a call
  // from the budget; this is the backstop, reported the same way and never spawned.
  if (Buffer.byteLength(input.stdin, 'utf8') > MAX_PROMPT_BYTES) {
    return Promise.resolve(failure('request_rejected', 'prompt exceeds the size cap'));
  }
  if (input.signal?.aborted) return Promise.resolve(failure('request_rejected', 'aborted'));
  return new Promise<RunCliResult>((resolve) => {
    let child: ChildLike;
    try {
      child = spawn(input.bin, input.args, {
        cwd: input.cwd,
        env: input.env as NodeJS.ProcessEnv,
        shell: false,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error: unknown) {
      resolve(
        isMissingBinary(error)
          ? failure('not_installed', 'binary not found')
          : failure('error', 'spawn failed'),
      );
      return;
    }

    // Review L4: known to the shutdown handler until Node reports the child exited.
    const pid = child.pid;
    if (pid !== undefined) {
      calls.addPid(pid);
      const forget = (): void => calls.dropPid(pid);
      child.on('exit', forget);
      child.on('close', forget);
    }

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let captured = 0;
    let settled = false;
    let closed = false;
    let pending: RunCliResult | null = null;
    let grace: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: RunCliResult): void => {
      clearTimeout(grace);
      pending = null;
      resolve(result);
    };
    const killAll = (): void => killChildGroup(child, killGroup, closed);
    const onAbort = (): void => settle(failure('request_rejected', 'aborted'));
    /**
     * Every exit path kills the whole group, so no grandchild outlives the call,
     * and the call resolves only once the child has closed, so its directories
     * are removed after the process is gone, never while it is still dying.
     */
    const settle = (result: RunCliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      killAll();
      if (closed || child.pid === undefined) {
        finish(result);
        return;
      }
      pending = result;
      grace = setTimeout(() => finish(withGraceNote(result)), CLI_CLOSE_GRACE_MS);
    };
    const timer = setTimeout(() => settle(failure('timeout', 'timed out')), input.timeoutMs);

    input.signal?.addEventListener('abort', onAbort, { once: true });

    const collect = (sink: Buffer[]) => (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      captured += buffer.length;
      if (captured > input.maxOutputBytes) {
        settle(failure('invalid_output', 'output exceeded the cap'));
        return;
      }
      sink.push(buffer);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    // An unhandled 'error' event on a stream would crash the server; the child's
    // own 'close' or 'error' event reports the outcome.
    child.stdout.on('error', () => undefined);
    child.stderr.on('error', () => undefined);

    // Fixed strings only: an error message can contain the binary path.
    child.on('error', (error: Error) =>
      settle(
        isMissingBinary(error)
          ? failure('not_installed', 'binary not found')
          : failure('error', 'process error'),
      ),
    );
    child.on('close', (code: number | null) => {
      if (closed) return;
      closed = true;
      if (settled) {
        if (pending !== null) finish(pending);
        return;
      }
      const stdout = Buffer.concat(out).toString('utf8');
      if (code === 0) {
        settle({ ok: true, stdout });
        return;
      }
      const stderr = Buffer.concat(err).toString('utf8');
      settle(failure(classifyCliFailure(code, stderr, stdout), `exit ${code ?? 'signal'}`));
    });

    // An early exit surfaces as EPIPE here; the close event reports the real outcome.
    child.stdin.on('error', () => undefined);
    child.stdin.write(input.stdin);
    child.stdin.end();
  });
}
