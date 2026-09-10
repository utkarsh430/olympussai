/**
 * An interactive, browser-real harness for the simulator console.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * `/ops/control-room/simulator` cannot be opened the ordinary way in a review
 * environment: it is behind `requireOpsRolePage`, which needs a real Supabase
 * session for a seeded operator account, and it reads its report from a
 * control service the captain is usually already running on :8080 - where a
 * POST would overwrite the report they are looking at. Reviewing the screen by
 * taking that port, or by weakening the guard, would both be wrong.
 *
 * So this mounts the REAL SimulatorConsole - the same component the guarded
 * page renders, with the real design system and the real Tailwind build - in a
 * real browser, over a report produced offline by
 * `pnpm --dir control-service sim:fleet --out <dir>`, which needs no database
 * and no environment and writes nothing but the report it just produced.
 *
 * ─── WHAT IT IS FOR ──────────────────────────────────────────────────────
 *
 * Reading the page as an operator does. The console's job is now ORDER - the
 * answer first, the reasoning behind a disclosure - and that is a claim about
 * what fits on a screen, which no unit test can check. The theme switch is
 * here for the same reason: every colour on this page resolves to a token, and
 * the only way to be sure of that is to look at both.
 *
 * Run it with scripts/serve-simulator-preview.mjs, which bundles this entry
 * with esbuild and serves it on a scratch port.
 */
import { createRoot } from 'react-dom/client';
import { StrictMode, useEffect, useState } from 'react';
import { SimulatorConsole } from '../src/components/ops/control-room/simulator/SimulatorConsole';
import type { FleetTrialReport } from '../src/models/fleetTrial';

function Harness() {
  const [report, setReport] = useState<FleetTrialReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    fetch('/report.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`report.json: ${r.status}`))))
      .then((body: FleetTrialReport) => setReport(body))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="min-h-full bg-background text-foreground">
      {/* Says what this is, on the page. A harness that looked like production
          would be the same dishonesty the console itself exists to remove. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-2 text-xs">
        <span className="text-muted-foreground">
          <strong className="text-foreground">Review harness</strong> — the real SimulatorConsole
          over an offline <code>sim:fleet</code> report. Not production, and nothing here is served
          by the control service.
        </span>
        <button
          type="button"
          className="ops-button"
          onClick={() => setDark((d) => !d)}
          aria-pressed={dark}
        >
          {dark ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      <div className="mx-auto max-w-[1600px] p-6">
        {error ? (
          <p className="text-sm text-destructive">Could not load the report: {error}</p>
        ) : report === null ? (
          <p className="text-sm text-muted-foreground">Loading the report…</p>
        ) : (
          // Mounted only once the report is in hand. `SimulatorConsole` seeds
          // its reducer from `initialReport` in a useReducer INITIALISER,
          // which runs once - so handing it a report after mount would be
          // silently ignored, and the harness would review the empty state.
          <SimulatorConsole initialReport={report} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
