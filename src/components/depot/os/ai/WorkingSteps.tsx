'use client';

import { useCallback, useRef, useState } from 'react';
import { Check, CircleDashed, Loader2, X } from 'lucide-react';

/**
 * The AI's working state for a computation a person started: each real step in order,
 * marked as it actually completes, with the time it took and what it found. The steps
 * yield one frame between them so each is drawn as it finishes; nothing is delayed for
 * show, so a fast step simply completes fast.
 */

export interface StepView {
  readonly label: string;
  readonly state: 'pending' | 'running' | 'done' | 'failed';
  readonly ms?: number;
  readonly result?: string;
}

export interface StepDef<C> {
  readonly label: string;
  /** Does the work on the shared context and returns the line it found. */
  readonly run: (ctx: C) => string;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

export function useStepRunner<C>() {
  const [steps, setSteps] = useState<readonly StepView[]>([]);
  const [running, setRunning] = useState(false);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const ticket = useRef(0);

  const run = useCallback(async (defs: readonly StepDef<C>[], ctx: C): Promise<C | null> => {
    const mine = ticket.current + 1;
    ticket.current = mine;
    setRunning(true);
    setTotalMs(null);
    setSteps(defs.map((d) => ({ label: d.label, state: 'pending' })));
    let total = 0;
    for (let i = 0; i < defs.length; i += 1) {
      setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, state: 'running' } : s)));
      await nextFrame();
      if (ticket.current !== mine) return null;
      const started = performance.now();
      try {
        const result = defs[i]!.run(ctx);
        const ms = performance.now() - started;
        total += ms;
        setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, state: 'done', ms, result } : s)));
      } catch {
        setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, state: 'failed', result: 'This step could not complete on the current data.' } : s)));
        setRunning(false);
        return null;
      }
    }
    setTotalMs(total);
    setRunning(false);
    return ctx;
  }, []);

  return { steps, running, totalMs, run };
}

function StepIcon({ state }: { readonly state: StepView['state'] }) {
  if (state === 'done') return <Check className="h-3.5 w-3.5 text-holo-teal" aria-hidden />;
  if (state === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-holo-glow" aria-hidden />;
  if (state === 'failed') return <X className="h-3.5 w-3.5 text-alert-crimson" aria-hidden />;
  return <CircleDashed className="h-3.5 w-3.5 text-depot-faint" aria-hidden />;
}

/** The steps as a vertical trace, each with its measured time and its finding. */
export function WorkingSteps({ steps, totalMs, title = 'AI working state' }: { readonly steps: readonly StepView[]; readonly totalMs: number | null; readonly title?: string }) {
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.state === 'done').length;
  return (
    <section aria-label={title} className="os-working" data-testid="os-working-steps">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="os-kicker text-holo-glow">{title}</span>
        <span className="font-mono text-[10.5px] text-depot-muted">
          {totalMs === null ? `${done} of ${steps.length}` : `Complete · ${Math.max(1, Math.round(totalMs))} ms`}
        </span>
      </div>
      <div className="os-bar-track mb-2.5">
        <span className="absolute inset-y-0 left-0 rounded-full bg-holo-glow transition-[width] duration-200" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.label} className={`flex items-start gap-2 ${s.state === 'pending' ? 'opacity-50' : ''}`}>
            <span className="mt-[2px]">
              <StepIcon state={s.state} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-sans text-[12px] font-semibold text-depot-ink">
                  {i + 1}. {s.label}
                </span>
                {s.ms !== undefined ? <span className="shrink-0 font-mono text-[10px] text-depot-muted">{s.ms < 1 ? '<1' : Math.round(s.ms)} ms</span> : null}
              </span>
              {s.result ? <span className="os-stream-in block font-sans text-[11.5px] leading-4 text-depot-prose">{s.result}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
