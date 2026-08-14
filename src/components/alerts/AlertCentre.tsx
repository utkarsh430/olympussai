'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import { BellRing, GitMerge, TrafficCone, Wrench, Users, Check, X } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { buildScenario } from '@/lib/simulation/scenarioEngine';
import { ALERT_KIND_LABELS, SEVERITY_ORDER, type AlertKind, type FleetAlert } from '@/lib/alerts/alertEngine';
import { formatRelativeAge } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<AlertKind, typeof GitMerge> = {
  bunching: GitMerge,
  traffic: TrafficCone,
  breakdown: Wrench,
  demand: Users,
};

const SEVERITY_STYLE = {
  critical: { text: 'text-alert-crimson', border: 'border-alert-crimson/45', bg: 'bg-alert-crimson/[0.08]', dot: 'bg-alert-crimson' },
  warning: { text: 'text-alert-amber', border: 'border-alert-amber/40', bg: 'bg-alert-amber/[0.07]', dot: 'bg-alert-amber' },
  advisory: { text: 'text-holo-teal', border: 'border-holo-teal/35', bg: 'bg-holo-teal/[0.06]', dot: 'bg-holo-teal' },
  info: { text: 'text-holo-glow', border: 'border-holo-glow/30', bg: 'bg-holo-glow/[0.05]', dot: 'bg-holo-glow' },
} as const;

/**
 * Predictive alert feed.
 *
 * Each alert carries a real registration, depot, route and map position from
 * the live feed. The predicted condition comes from the copilot's models, which
 * is why the panel is marked PREDICTIVE.
 */
export function AlertCentre() {
  const alerts = useCopilotStore((state) => state.alerts);
  const acknowledgeAlert = useCopilotStore((state) => state.acknowledgeAlert);
  const dismissAlert = useCopilotStore((state) => state.dismissAlert);
  const selectBus = useCopilotStore((state) => state.selectBus);
  const setScenario = useCopilotStore((state) => state.setScenario);
  const setAi = useCopilotStore((state) => state.setAi);
  const overrides = useCopilotStore((state) => state.overrides);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const selectedBusId = useCopilotStore((state) => state.selectedBusId);

  // Critical first, then most recent.
  const ordered = useMemo(
    () =>
      [...alerts].sort((a, b) => {
        const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (severity !== 0) return severity;
        return Date.parse(b.raisedAt) - Date.parse(a.raisedAt);
      }),
    [alerts],
  );

  const unacknowledged = alerts.filter((alert) => !alert.acknowledged).length;

  function openAlert(alert: FleetAlert) {
    const bus = useCopilotStore.getState().buses.find((candidate) => candidate.id === alert.busId);
    if (!bus) return;

    selectBus(bus.id);
    acknowledgeAlert(alert.id);

    // Rebuild the full analysis for the same vehicle the alert was raised on.
    const scenario = buildScenario(alert.kind, { bus, schedule: null, overrides });
    setScenario(alert.kind, scenario);
    setAi('Recommendation Ready', `${alert.title} — analysis ready for ${alert.registrationNumber}.`);

    logAudit('alert-displayed', `${alert.title} opened for ${alert.registrationNumber}`, {
      registrationNumber: alert.registrationNumber,
    });
  }

  return (
    <aside
      className="hud-panel hud-corners relative z-20 flex w-[290px] shrink-0 flex-col overflow-hidden"
      aria-label="Things that may be about to go wrong"
      data-testid="alert-centre"
    >
      <header className="shrink-0 border-b border-holo-glow/15 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
            <BellRing className="h-3.5 w-3.5" aria-hidden />
            Alert Centre
          </h2>
          {/* The single provenance marker for the whole feed. */}
          <span
            className="rounded border border-holo-teal/45 bg-holo-teal/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-holo-teal"
            title="Forward-looking projections from the copilot's models, anchored to live vehicle data."
          >
            Predictive
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="hud-label">Active</span>
          <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-holo-glow">
            <span>{alerts.length}</span>
            {unacknowledged > 0 && (
              <span className="rounded border border-alert-amber/45 bg-alert-amber/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-alert-amber">
                {unacknowledged} new
              </span>
            )}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" role="list">
        {alerts.length === 0 && (
          <p className="px-3 py-8 text-center font-mono text-[11px] leading-relaxed text-holo-glow/40">
            Monitoring the network. Projected operational risks will appear here.
          </p>
        )}

        <AnimatePresence initial={false}>
          {ordered.map((alert) => {
            const style = SEVERITY_STYLE[alert.severity];
            const Icon = KIND_ICON[alert.kind];
            const isOpen = alert.busId === selectedBusId;

            return (
              <motion.div
                key={alert.id}
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                role="listitem"
                data-testid="alert-item"
                data-alert-kind={alert.kind}
                className={cn(
                  'group relative border-b border-holo-glow/[0.07]',
                  isOpen && 'bg-holo-glow/[0.07]',
                )}
              >
                {!alert.acknowledged && (
                  <span
                    aria-hidden
                    className={cn('absolute inset-y-0 left-0 w-[2px]', style.dot)}
                  />
                )}

                <button
                  type="button"
                  onClick={() => openAlert(alert)}
                  className="w-full px-3 py-2.5 text-left transition-colors hover:bg-holo-glow/[0.06]"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className={cn('flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider', style.text)}>
                      <Icon className="h-3 w-3" aria-hidden />
                      {ALERT_KIND_LABELS[alert.kind]}
                    </span>
                    <span className="font-mono text-[9px] text-holo-glow/35">
                      {formatRelativeAge(alert.raisedAt)}
                    </span>
                  </div>

                  <p className={cn('mb-1 font-mono text-[11px] leading-snug', style.text)}>
                    {alert.title}
                  </p>

                  <p className="mb-1.5 font-mono text-[10px] leading-relaxed text-holo-glow/55">
                    {alert.summary}
                  </p>

                  {/* Real vehicle identity from the live feed. */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[10px] font-semibold tracking-wider text-holo-glow">
                      {alert.registrationNumber}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-holo-glow/40">
                      {alert.confidencePercent}% confidence
                    </span>
                  </div>

                  <div className="mt-0.5 truncate font-mono text-[9px] text-holo-glow/30">
                    {alert.depotName ?? 'Unknown depot'}
                    {alert.routeName ? ` · ${alert.routeName}` : ''}
                  </div>

                  {/* Severity in words, not colour alone. */}
                  <span className="sr-only">{alert.severityText}</span>
                </button>

                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {!alert.acknowledged && (
                    <button
                      type="button"
                      onClick={() => acknowledgeAlert(alert.id)}
                      aria-label={`Acknowledge alert for ${alert.registrationNumber}`}
                      className="rounded border border-holo-glow/25 bg-void-900/85 p-1 text-holo-glow/60 hover:border-holo-glow/60 hover:text-holo-glow"
                    >
                      <Check className="h-2.5 w-2.5" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissAlert(alert.id)}
                    aria-label={`Dismiss alert for ${alert.registrationNumber}`}
                    className="rounded border border-holo-glow/25 bg-void-900/85 p-1 text-holo-glow/60 hover:border-alert-crimson/60 hover:text-alert-crimson"
                  >
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <footer className="shrink-0 border-t border-holo-glow/15 px-3 py-2">
        <p className="font-mono text-[9px] leading-relaxed text-holo-glow/40">
          Vehicle identity, depot, route and position are live. Projected conditions are
          model outputs pending dispatcher review.
        </p>
      </footer>
    </aside>
  );
}
