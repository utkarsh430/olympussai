export interface CliArgsInput {
  readonly schemaJson: string;
  readonly systemPrompt: string;
  readonly model: string;
}

/**
 * Argument vector for `claude -p`. Every value is a separate element and the
 * process is spawned without a shell, so nothing here is ever parsed as a
 * command line. The user prompt never appears: it goes on stdin.
 *
 * Isolation, from `claude --help` (v2.1.x):
 * - `--tools ''` disables every built-in tool; `--restricted` also ignores
 *   user, project and local settings; `--strict-mcp-config` skips MCP servers.
 * - `--safe-mode` turns off CLAUDE.md, skills, plugins, hooks, custom agents
 *   and commands; auth and model selection still work, so OAuth is unaffected.
 * - `--disable-slash-commands` turns off skills as a second layer.
 * - `--permission-prompts none` denies anything that would prompt, so no host
 *   can be asked to approve something in print mode.
 * Deliberately absent: `--bare` (cannot read the subscription token) and
 * `--max-turns` (not in this CLI).
 */
export function buildCliArgs(input: CliArgsInput): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    input.schemaJson,
    '--system-prompt',
    input.systemPrompt,
    '--tools',
    '',
    '--restricted',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--model',
    input.model,
    '--safe-mode',
    '--disable-slash-commands',
    '--permission-prompts',
    'none',
  ];
}
