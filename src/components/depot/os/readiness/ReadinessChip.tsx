import { READINESS_LABEL, type CheckState, type Readiness } from '@/lib/depot/os/intel/readiness';

const CLASS: Readonly<Record<Readiness, string>> = {
  ready: 'border-alert-green/45 bg-alert-green/[0.08] text-alert-green',
  at_risk: 'border-alert-amber/50 bg-alert-amber/10 text-alert-amber',
  blocked: 'border-alert-crimson/50 bg-alert-crimson/10 text-alert-crimson',
  unverified: 'border-slate-400/40 bg-slate-400/[0.08] text-slate-300',
  departed: 'border-holo-glow/40 bg-holo-glow/[0.07] text-holo-glow',
  completed: 'border-depot-line text-depot-muted',
};

export const READINESS_BAR: Readonly<Record<Readiness, string>> = {
  ready: 'bg-alert-green',
  at_risk: 'bg-alert-amber',
  blocked: 'bg-alert-crimson',
  unverified: 'bg-slate-400',
  departed: 'bg-holo-glow',
  completed: 'bg-depot-line-strong',
};

export function ReadinessChip({ readiness }: { readonly readiness: Readiness }) {
  return <span className={`os-chip ${CLASS[readiness]}`}>{READINESS_LABEL[readiness]}</span>;
}

const CHECK_CLASS: Readonly<Record<CheckState, string>> = {
  ok: 'bg-alert-green',
  warn: 'bg-alert-amber',
  fail: 'bg-alert-crimson',
  unknown: 'bg-slate-500',
};

export function CheckDot({ state, title }: { readonly state: CheckState; readonly title: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${CHECK_CLASS[state]}`} title={title} aria-label={title} role="img" />;
}
