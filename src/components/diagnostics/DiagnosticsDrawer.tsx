'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { X, Activity, Database, Map as MapIcon, ShieldCheck } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { Badge } from '@/components/shared/hud';
import { formatIndiaDateTime, formatRelativeAge, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/** Developer diagnostics. Never displays secrets — only presence/absence. */
export function DiagnosticsDrawer() {
  const isOpen = useCopilotStore((state) => state.isDiagnosticsOpen);
  const toggle = useCopilotStore((state) => state.toggleDiagnostics);
  const meta = useCopilotStore((state) => state.feedMeta);
  const buses = useCopilotStore((state) => state.buses);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggle(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, toggle]);

  const mapKeyConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
  const gpsHealthy = !meta.error && meta.source !== 'fixture';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: 440, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 440, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="hud-panel-strong hud-corners fixed right-0 top-0 z-[95] flex h-full w-[430px] flex-col overflow-hidden"
          role="dialog"
          aria-label="Developer diagnostics"
          data-testid="diagnostics-drawer"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-holo-glow/20 px-4 py-3">
            <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              System Diagnostics
            </h2>
            <button
              type="button"
              onClick={() => toggle(false)}
              className="hud-button px-2 py-1"
              aria-label="Close diagnostics"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <Group title="GPS Endpoint Health" icon={Activity}>
              <Row
                label="Status"
                value={
                  <Badge variant={gpsHealthy ? 'live' : meta.error ? 'critical' : 'fixture'} pulse>
                    {meta.error ? 'DEGRADED' : meta.source === 'fixture' ? 'FIXTURE MODE' : 'HEALTHY'}
                  </Badge>
                }
              />
              <Row label="Source" value={meta.source ?? '—'} />
              <Row
                label="Last successful fetch"
                value={meta.lastFetchAt ? formatIndiaDateTime(meta.lastFetchAt) : '—'}
              />
              <Row label="Cache age" value={formatRelativeAge(meta.lastFetchAt)} />
              <Row label="Stale" value={meta.stale ? 'YES' : 'NO'} tone={meta.stale ? 'amber' : 'green'} />
              {meta.error && <Row label="Last error" value={meta.error} tone="crimson" />}
            </Group>

            <Group title="Record Pipeline" icon={Database}>
              <Row label="Raw upstream records" value={formatNumber(meta.recordCount)} />
              <Row label="Normalized buses" value={formatNumber(meta.normalizedCount)} />
              <Row
                label="Rejected records"
                value={formatNumber(meta.rejectedRecordCount)}
                tone={meta.rejectedRecordCount > 0 ? 'amber' : 'green'}
              />
              <Row label="Currently in store" value={formatNumber(buses.length)} />
              <Row
                label="Rejection rate"
                value={
                  meta.recordCount > 0
                    ? `${((meta.rejectedRecordCount / meta.recordCount) * 100).toFixed(2)}%`
                    : '—'
                }
              />
            </Group>

            <Group title="Schedule Endpoint" icon={Database}>
              <Row label="Last source" value={meta.scheduleSource ?? 'not yet requested'} />
              <Row
                label="Last message"
                value={meta.scheduleError ?? 'none'}
                tone={meta.scheduleError ? 'amber' : 'green'}
              />
              <Row label="Fetch policy" value="on bus selection only" />
            </Group>

            <Group title="Map Configuration" icon={MapIcon}>
              <Row
                label="Google Maps key"
                value={mapKeyConfigured ? 'configured' : 'MISSING'}
                tone={mapKeyConfigured ? 'green' : 'crimson'}
              />
              <Row label="Basemap" value="Google Maps JavaScript API" />
              <Row label="Traffic layer" value="disabled (modelled only)" tone="amber" />
              <Row label="Routes API" value="not used" tone="amber" />
              <Row label="Marker clustering" value="enabled" tone="green" />
            </Group>

            <Group title="Prediction Engine" icon={Activity}>
              <Row label="LLM calls" value="none — local templates" tone="green" />
              <Row label="Seeding" value="deterministic per registration" tone="green" />
              <Row label="Fixture mode" value={process.env.NEXT_PUBLIC_DEMO_MODE === '1' ? 'FORCED' : 'auto'} />
            </Group>

            <p className="rounded border border-holo-glow/15 bg-void-900/50 px-3 py-2 font-mono text-[9px] leading-relaxed text-holo-glow/45">
              No credentials, tokens or device identifiers are displayed in this panel. Only the
              presence of configuration is reported.
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Group({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-holo-teal">
        <Icon className="h-3 w-3" aria-hidden />
        {title}
      </h3>
      <dl className="space-y-1">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'amber' | 'crimson' | 'green';
}) {
  const colour =
    tone === 'crimson'
      ? 'text-alert-crimson'
      : tone === 'amber'
        ? 'text-alert-amber'
        : tone === 'green'
          ? 'text-alert-green'
          : 'text-holo-glow/75';

  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <dt className="shrink-0 font-mono text-[10px] text-holo-glow/40">{label}</dt>
      <dd className={cn('text-right font-mono text-[10px] tabular-nums', colour)}>{value}</dd>
    </div>
  );
}
