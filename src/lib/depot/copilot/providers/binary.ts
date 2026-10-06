import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

/** The two facts about a path the check needs; a plain object so it is testable. */
export interface StatLike {
  readonly isFile: boolean;
  readonly mode: number;
  readonly uid: number;
}

/** The file-system calls the check makes, injected so tests never touch the disk. */
export interface BinaryFs {
  realpath(path: string): string;
  stat(path: string): StatLike;
}

const ANY_EXECUTE = 0o111;
const GROUP_OR_WORLD_WRITE = 0o022;
const ROOT_UID = 0;
/** Fixed on purpose: Node's own message would carry the path. */
const MISSING = 'The Claude binary is missing or unreadable';

export const nodeBinaryFs: BinaryFs = {
  realpath: (path) => realpathSync(path),
  stat: (path) => {
    const stats = statSync(path);
    return { isFile: stats.isFile(), mode: stats.mode, uid: stats.uid };
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
export function binaryProblem(
  file: StatLike,
  dir: StatLike,
  serverUid?: number,
): string | null {
  // The owner can always rewrite the file: only root or the server's own user is trusted.
  const trusted = (uid: number): boolean => uid === ROOT_UID || uid === serverUid;
  if (!trusted(file.uid) || !trusted(dir.uid)) {
    return 'The Claude binary or its directory has an untrusted owner';
  }
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
 * Run at startup and again before every call (a few stat calls), so a
 * self-update that replaces the versioned file is picked up without a restart: the path must be absolute; its real path is resolved (so a
 * symlink is judged by what it points at) and checked with `binaryProblem`.
 * Returns the real path, which is what should be spawned, so a link swapped
 * after this check cannot redirect the call. Throws on any problem, including
 * a missing file.
 */
export function assertUsableBinary(
  path: string,
  fs: BinaryFs = nodeBinaryFs,
  serverUid: number | undefined = process.getuid?.(),
): string {
  if (!isAbsoluteBinary(path)) throw new Error('The Claude binary path must be absolute');
  let real: string;
  let problem: string | null;
  try {
    real = fs.realpath(path);
    problem = binaryProblem(fs.stat(real), fs.stat(dirname(real)), serverUid);
  } catch {
    throw new Error(MISSING); // never Node's message, which contains the path
  }
  if (problem !== null) throw new Error(problem);
  return real;
}
