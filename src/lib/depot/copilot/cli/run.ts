import { classifyCliFailure } from '@/lib/depot/copilot/cli/classify';
import { MAX_PROMPT_BYTES } from '@/lib/depot/copilot/limits';
import type { FallbackReason } from '@/lib/depot/copilot/types';

/** Minimal structural views of Node's `child_process.spawn`, so tests can fake it. */
export interface SpawnOptionsLike {
  readonly cwd: string;
  /** Typed as Node's own env so the real `spawn` fits; the value is always an allowlisted record. */
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly stdio: ['pipe', 'pipe', 'pipe'];
  readonly windowsHide: true;
}

interface DataStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface ChildLike {
  readonly stdin: {
    write(chunk: string): unknown;
    end(): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
  };
  readonly stdout: DataStream;
  readonly stderr: DataStream;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
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
}

export type RunCliResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: FallbackReason; readonly detail: string };

const DETAIL_CHARS = 200;

const isMissingBinary = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';

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
export function runCli(input: RunCliInput, spawn: SpawnLike): Promise<RunCliResult> {
  if (Buffer.byteLength(input.stdin, 'utf8') > MAX_PROMPT_BYTES) {
    return Promise.resolve(failure('request_rejected', 'prompt exceeds the size cap'));
  }
  return new Promise<RunCliResult>((resolve) => {
    let child: ChildLike;
    try {
      child = spawn(input.bin, input.args, {
        cwd: input.cwd,
        env: input.env as NodeJS.ProcessEnv,
        shell: false,
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

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let captured = 0;
    let settled = false;

    const settle = (result: RunCliResult, kill: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (kill) child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => settle(failure('timeout', 'timed out'), true), input.timeoutMs);

    const collect = (sink: Buffer[]) => (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      captured += buffer.length;
      if (captured > input.maxOutputBytes) {
        settle(failure('invalid_output', 'output exceeded the cap'), true);
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
        false,
      ),
    );
    child.on('close', (code: number | null) => {
      const stdout = Buffer.concat(out).toString('utf8');
      if (code === 0) {
        settle({ ok: true, stdout }, false);
        return;
      }
      const stderr = Buffer.concat(err).toString('utf8');
      settle(failure(classifyCliFailure(code, stderr, stdout), `exit ${code ?? 'signal'}`), false);
    });

    // An early exit surfaces as EPIPE here; the close event reports the real outcome.
    child.stdin.on('error', () => undefined);
    child.stdin.write(input.stdin);
    child.stdin.end();
  });
}
