const SYSTEM_PATH = '/usr/bin:/bin';

/**
 * The child's whole environment, built from an allowlist. It is a new object
 * assembled key by key: the parent is never spread, so a secret added to the
 * server's environment later cannot leak. In particular `ANTHROPIC_API_KEY` is
 * absent, because passing it would silently switch billing off the subscription.
 *
 * PATH is not inherited either: it is the running node's directory (in case the
 * CLI is a node script) plus the system directories. The parent only contributes
 * the OAuth token.
 */
export function buildChildEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
  home: string,
  nodeDir: string,
): Record<string, string> {
  if (!nodeDir.startsWith('/') || nodeDir.includes(':'))
    throw new RangeError('Invalid node directory');
  const env: Record<string, string> = {
    PATH: `${SYSTEM_PATH}:${nodeDir}`,
    HOME: home,
  };
  const token = parentEnv.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}
