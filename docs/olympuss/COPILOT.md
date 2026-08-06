# Control-Room Copilot: Incident Explanation, Shift-Report Drafts, NL Query

An LLM-backed copilot for the control-room role: it explains currently-open
bunching incidents, drafts shift-report handoffs, and answers natural-
language questions.
Every answer is grounded in stored incident/audit records and cites them.
It is entirely outside the command path — it can explain and summarize what
has already happened, but it can never create, approve, or dispatch a
command.

## Why a separate module, not an extension of the observability dashboard

`src/lib/controlService/observabilityData.ts` (the existing headway/EWT/CV +
incidents dashboard) is a pure read-and-display path: it fetches from the
control service and renders it, with no LLM and no write path of its own.
The copilot needed here does something structurally different — it calls an
external LLM with incident data, and it persists two new kinds of records
(an audit log of every LLM call, and AI-drafted shift reports awaiting human
review) — so it is its own module, `src/lib/copilot/`, rather than a
function bolted onto the dashboard's data layer.

## Module boundary: never the command path

The ticket's hardest acceptance criterion is architectural, not functional:
"No code path in the copilot module can call the command-creation/approval
service."
Concretely, that means `src/lib/copilot/**` and
`src/app/api/ops/control-room/copilot/**` never import:

- `src/lib/auth/rbac/repo.ts` (where `createDispatcherAction` /
  `consumeDispatcherAction` / `recordAuditEvent` live — the command-approval
  surface).
- `src/app/api/ops/control-room/commands/route.ts` (issues a command).
- `src/app/api/ops/dispatcher/approvals/route.ts` (issues a dispatcher
  approval).
- The control service's `POST /v1/commands` route, directly or indirectly —
  this app in fact has no client function that calls it at all yet (see
  that route file's own doc comment), so this is also true by construction,
  not just by discipline.

This is enforced two ways, not one, so a single mistake cannot silently
regress it:

1. An eslint `no-restricted-imports` override scoped to those two
   directories (`eslint.config.mjs`).
2. A static source-scan test, `src/tests/unit/copilotBoundary.test.ts`, that
   fails the build if any forbidden import specifier appears in either
   directory.

The copilot's only writes are to its own two tables
(`ops_copilot_interactions`, `ops_shift_report_drafts` —
`db/migrations/20260806140000__ops_copilot.sql`); everything else it
touches is a read: `GET /v1/incidents` on the control service, and
`select`-only queries against `ops_audit_log` / `ops_breakdown_reports`
(`src/lib/copilot/grounding.ts`).

## Grounding and citations

`src/lib/copilot/prompts.ts` builds every prompt from an explicit,
enumerated evidence list — each record tagged with a stable id, e.g.
`[incident:<uuid>]` or `[audit:<uuid>]`.
The system prompt instructs the model to use only that evidence, cite a
record id for every claim, and say so plainly when the evidence does not
support an answer.

Critically, the `citations` array returned to the client is never parsed out
of the model's free-text answer.
It is built directly from the same evidence-record list handed to the
model, before the LLM call happens.
That makes "cite source records" a structural guarantee: whatever the model
writes, the citation list attached to the response is exactly the evidence
it was shown, never something inferred from its prose.

Available evidence sources today:

- Currently-**open** bunching incidents (`GET /v1/incidents` on the control
  service — there is no closed/historical incident lookup endpoint yet, so
  a shift-report draft's incident section reflects what is open at draft
  time, not a full history of the period; the prompt says so rather than
  implying broader coverage).
- This app's own `ops_audit_log` (commands issued, approvals, suggestion
  responses).
- `ops_breakdown_reports` (driver-submitted breakdown reports).

## LLM adapter

`src/lib/copilot/anthropic.ts` calls the Anthropic Messages API directly
over `fetch` — no vendor SDK, matching this repo's existing rule for
single-endpoint HTTP integrations (see `src/lib/email/resend.ts`'s doc
comment).
Configured by `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (see `README.md`'s env
var table); unset means every copilot endpoint returns
`503 COPILOT_UNAVAILABLE` rather than fabricating a response.
The API key and the raw prompt/response text are never written to
`console` — only a status code and a short error preview reach the process
log; the full prompt/response is persisted to `ops_copilot_interactions`
instead, which is access-controlled the same way as the rest of the ops
audit trail.

## Audit logging

Every LLM call — success or failure — writes one row to
`ops_copilot_interactions` (`src/lib/copilot/repo.ts` `logCopilotInteraction`):
the exact prompt sent, the response received (or the error), the citation
set, the model, and the actor (`ops_users.id` + role).
The table is append-only at the database level (a trigger rejects `UPDATE`
and `DELETE`, same pattern as `ops_audit_log` in `RBAC.md`), so this is a
durable audit trail, not an application-level convention that a bug could
quietly violate.

## Shift-report drafts: AI-drafted, human-finalized, never auto-published

`POST /api/ops/control-room/copilot/shift-reports` generates a draft and
persists it with `status='draft'`, `ai_drafted=true`.
The UI (`ShiftReportCopilotForm.tsx`) renders it behind a visible
"AI-drafted — review before sending" label with two buttons, **Save** and
**Send**, each calling `POST .../shift-reports/[id]/finalize` with a
different `action`.

Three independent layers make "never auto-publish" a guarantee rather than
a convention:

1. `src/lib/copilot/repo.ts` `createShiftReportDraft` takes no `status`
   parameter — there is no code path that can create a draft in anything
   but the `draft` state.
2. The migration's `CHECK` constraints make a `saved`/`sent` row without a
   human `saved_by`/`sent_by` impossible at the database level, regardless
   of what application code attempts.
3. `finalizeShiftReportDraft` is an atomic
   `UPDATE ... WHERE status = 'draft'`, requires an authenticated ops
   session on every call (`requireOpsRole(['control_room'])` in the route
   handler), and there is no scheduled job, webhook, or other automated
   caller anywhere in this codebase that reaches it.

## Surface

- `GET /ops/control-room/copilot` — the dispatcher-facing page: explain an
  active incident, draft/save/send a shift report, ask a question.
- `POST /api/ops/control-room/copilot/explain` — incident narrative.
- `POST /api/ops/control-room/copilot/query` — NL question answering.
- `POST /api/ops/control-room/copilot/shift-reports` — generate + persist a
  draft.
- `GET /api/ops/control-room/copilot/shift-reports/[id]` — reload a draft.
- `POST /api/ops/control-room/copilot/shift-reports/[id]/finalize` — save or
  send (human action only).

All five require an authenticated `control_room` ops session
(`requireOpsRole`), same as the existing control-room commands endpoint.
