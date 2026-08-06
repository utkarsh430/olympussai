import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Ticket AC: "No code path in the copilot module can call the
    // command-creation/approval service." src/lib/copilot/service.ts's doc
    // comment explains the intended boundary; this enforces it at lint
    // time, and src/tests/unit/copilotBoundary.test.ts enforces it again
    // with a static source scan (belt and suspenders — either one alone
    // could in principle be disabled by an editor deleting a line, the
    // other would still fail CI).
    files: [
      "src/lib/copilot/**/*.{ts,tsx}",
      "src/app/api/ops/**/copilot/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/auth/rbac/repo",
              message:
                "The copilot module must never import the command-approval repo (createDispatcherAction / consumeDispatcherAction / recordAuditEvent) — see src/lib/copilot/service.ts's boundary doc comment.",
            },
          ],
          patterns: [
            {
              group: [
                "**/control-room/commands/route*",
                "**/dispatcher/approvals/route*",
                "**/webhooks/dispatch*",
              ],
              message:
                "The copilot module must never import the command-creation/approval route handlers.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
