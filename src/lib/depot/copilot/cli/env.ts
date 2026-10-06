const FALLBACK_PATH = '/usr/local/bin:/usr/bin:/bin';

/**
 * The child's whole environment, built from an allowlist. It is a new object
 * assembled key by key: the parent is never spread, so a secret added to the
 * server's environment later cannot leak. In particular `ANTHROPIC_API_KEY` is
 * absent, because passing it would silently switch billing off the subscription.
 */
export function buildChildEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
  home: string,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: parentEnv.PATH || FALLBACK_PATH,
    HOME: home,
  };
  const token = parentEnv.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}
