'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { GitMerge, TrafficCone, Wrench, Users, X, ChevronRight } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { buildScenario } from '@/lib/simulation/scenarioEngine';
import { ALERT_KIND_LABELS, type AlertKind, type FleetAlert } from '@/lib/alerts/alertEngine';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<AlertKind, typeof GitMerge> = {
  bunching: GitMerge,
  traffic: TrafficCone,
  breakdown: Wrench,
  demand: Users,
};

const SEVERITY_STYLE = {
  critical: { text: 'text-alert-crimson', border: 'border-alert-crimson/50', accent: 'bg-alert-crimson' },
  warning: { text: 'text-alert-amber', border: 'border-alert-amber/45', accent: 'bg-alert-amber' },
  advisory: { text: 'text-holo-teal', border: 'border-holo-teal/40', accent: 'bg-holo-teal' },
  info: { text: 'text-holo-glow', border: 'border-holo-glow/35', accent: 'bg-holo-glow' },
} as const;

/** How long a toast stays before retiring itself into the Alert Centre. */
const TOAST_TTL_MS = 11_000;

/** Transient popups for newly raised alerts, stacked over the map. */
export function AlertToasts() {
  const toasts = useCopilotStore((state) => state.toastQueue);

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 z-[45] flex w-[330px] -translate-x-1/2 flex-col items-stretch gap-2"
      aria-live="polite"
      aria-label="Incoming alerts"
    >
      <AnimatePresence initial={false}>
        {toasts.map((alert) => (
          <Toast key={alert.id} alert={alert} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Toast({ alert }: { alert: FleetAlert }) {
  const dismissToast = useCopilotStore((state) => state.dismissToast);
  const acknowledgeAlert = useCopilotStore((state) => state.acknowledgeAlert);
  const selectBus = useCopilotStore((state) => state.selectBus);
  const setScenario = useCopilotStore((state) => state.setScenario);
  const setAi = useCopilotStore((state) => state.setAi);
  const overrides = useCopilotStore((state) => state.overrides);
  const logAudit = useCopilotStore((state) => state.logAudit);

  const style = SEVERITY_STYLE[alert.severity];
  const Icon = KIND_ICON[alert.kind];

  // Critical alerts stay until the operator deals with them.
  useEffect(() => {
    if (alert.severity === 'critical') return;
    const timer = setTimeout(() => dismissToast(alert.id), TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [alert.id, alert.severity, dismissToast]);

  function open() {
    const bus = useCopilotStore.getState().buses.find((candidate) => candidate.id === alert.busId);
    if (!bus) return;

    selectBus(bus.id);
    acknowledgeAlert(alert.id);
    const scenario = buildScenario(alert.kind, { bus, schedule: null, overrides });
    setScenario(alert.kind, scenario);
    setAi('Recommendation Ready', `${alert.title} — analysis ready for ${alert.registrationNumber}.`);
    logAudit('alert-displayed', `${alert.title} opened for ${alert.registrationNumber}`, {
      registrationNumber: alert.registrationNumber,
    });
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -24, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className={cn(
        'hud-panel-strong hud-corners pointer-events-auto relative overflow-hidden border',
        style.border,
      )}
      data-testid="alert-toast"
      role="alert"
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', style.accent)} />

      <button type="button" onClick={open} className="w-full px-3 py-2.5 pl-4 text-left">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={cn('flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em]', style.text)}>
            <Icon className="h-3 w-3" aria-hidden />
            {ALERT_KIND_LABELS[alert.kind]}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-holo-teal/70">
            Predictive
          </span>
        </div>

        <p className={cn('mb-1 font-mono text-[11px] font-semibold leading-snug', style.text)}>
          {alert.title}
        </p>
        <p className="mb-1.5 font-mono text-[10px] leading-relaxed text-holo-glow/60">
          {alert.summary}
        </p>

        <div className="flex items-center justify-between gap-2 border-t border-holo-glow/10 pt-1.5">
          <span className="font-mono text-[10px] font-semibold tracking-wider text-holo-glow">
            {alert.registrationNumber}
          </span>
          <span className="flex items-center gap-1 font-mono text-[9px] text-holo-glow/45">
            Open analysis
            <ChevronRight className="h-2.5 w-2.5" aria-hidden />
          </span>
        </div>

        <span className="sr-only">{alert.severityText}</span>
      </button>

      <button
        type="button"
        onClick={() => dismissToast(alert.id)}
        aria-label={`Dismiss alert for ${alert.registrationNumber}`}
        className="absolute right-1.5 top-1.5 rounded p-1 text-holo-glow/35 transition-colors hover:text-holo-glow"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </motion.div>
  );
}
