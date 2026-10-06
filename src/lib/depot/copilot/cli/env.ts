const SYSTEM_PATH = '/usr/bin:/bin';

/**
 * Fixed, non-secret switches: no self-update and no non-essential
 * network traffic from a child whose HOME is empty and whose time is bounded.
 */
const FIXED_SWITCHES = {
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
} as const;

const isSafeDir = (dir: string): boolean => dir.startsWith('/') && !dir.includes('\0');

/**
 * The child's whole environment, built from an allowlist. It is a new object
 * assembled key by key: the parent is never spread, so a secret added to the
 * server's environment later cannot leak. In particular `ANTHROPIC_API_KEY` is
 * absent, because passing it would silently switch billing off the subscription.
 *
 * PATH is not inherited either: it is the running node's directory (in case the
 * CLI is a node script) plus the system directories. The parent only contributes
 * the OAuth token. TMPDIR is the call's own private folder, so the CLI's
 * temporary files are removed with it rather than left in the shared /tmp.
 */
export function buildChildEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
  home: string,
  nodeDir: string,
  tmpDir: string,
): Record<string, string> {
  if (!isSafeDir(tmpDir)) throw new RangeError('Invalid temporary directory');
  // Absolute, and no ':' (it would smuggle in a second PATH entry) or NUL.
  if (!nodeDir.startsWith('/') || nodeDir.includes(':') || nodeDir.includes('\0')) {
    throw new RangeError('Invalid node directory');
  }
  const env: Record<string, string> = {
    PATH: `${SYSTEM_PATH}:${nodeDir}`,
    HOME: home,
    TMPDIR: tmpDir,
    ...FIXED_SWITCHES,
  };
  const token = parentEnv.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}
