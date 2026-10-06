import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

/** The two facts about a path the check needs; a plain object so it is testable. */
export interface StatLike {
  readonly isFile: boolean;
  readonly mode: number;
}

/** The file-system calls the check makes, injected so tests never touch the disk. */
export interface BinaryFs {
  realpath(path: string): string;
  stat(path: string): StatLike;
}

const ANY_EXECUTE = 0o111;
const GROUP_OR_WORLD_WRITE = 0o022;

export const nodeBinaryFs: BinaryFs = {
  realpath: (path) => realpathSync(path),
  stat: (path) => {
    const stats = statSync(path);
    return { isFile: stats.isFile(), mode: stats.mode };
  },
};

/** Pure check: an absolute path with no NUL byte. */
export function isAbsoluteBinary(path: string): boolean {
  return path.length > 0 && !path.includes('\0') && isAbsolute(path);
}

/**
 * Pure check of a resolved binary and its directory. Anyone who can write to
 * either could swap the program the server runs with the operator's
 * subscription, so group- or world-writable is refused, as is a non-file.
 */
export function binaryProblem(file: StatLike, dir: StatLike): string | null {
  if (!file.isFile) return 'The Claude binary path is not a file';
  if ((file.mode & ANY_EXECUTE) === 0) return 'The Claude binary is not executable';
  if ((file.mode & GROUP_OR_WORLD_WRITE) !== 0) {
    return 'The Claude binary is group- or world-writable';
  }
  if ((dir.mode & GROUP_OR_WORLD_WRITE) !== 0) {
    return "The Claude binary's directory is group- or world-writable";
  }
  return null;
}

/**
 * Startup check: the path must be absolute; its real path is resolved (so a
 * symlink is judged by what it points at) and checked with `binaryProblem`.
 * Returns the real path, which is what should be spawned, so a link swapped
 * after this check cannot redirect the call. Throws on any problem, including
 * a missing file.
 */
export function assertUsableBinary(path: string, fs: BinaryFs = nodeBinaryFs): string {
  if (!isAbsoluteBinary(path)) throw new Error('The Claude binary path must be absolute');
  const real = fs.realpath(path);
  const problem = binaryProblem(fs.stat(real), fs.stat(dirname(real)));
  if (problem !== null) throw new Error(problem);
  return real;
}
