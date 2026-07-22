'use client';

import { useMemo } from 'react';
import {
  Maximize2,
  Minimize2,
  Scale,
  FlaskConical,
  ShieldCheck,
  ScrollText,
} from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { useIndiaClock } from '@/hooks/useIndiaClock';
import { Badge, CountUp } from '@/components/shared/hud';
import { LIVE_LABELS } from '@/lib/constants';
import { formatRelativeAge } from '@/lib/formatters';
import { useFleetDistribution } from '@/hooks/useFleetDistribution';
import { ProjectSignOut } from '@/components/upsrtc/ProjectSignOut';

export function TopCommandBar({
  visibleCount,
  onToggleFullscreen,
  isFullscreen,
}: {
  visibleCount: number;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
}) {
  const buses = useCopilotStore((state) => state.buses);
  const feedMeta = useCopilotStore((state) => state.feedMeta);
  const toggleScenarioLab = useCopilotStore((state) => state.toggleScenarioLab);
  const openFleetDistribution = useFleetDistribution();
  const toggleDiagnostics = useCopilotStore((state) => state.toggleDiagnostics);
  const toggleAudit = useCopilotStore((state) => state.toggleAudit);
  const clock = useIndiaClock();

  const connectionState = useMemo(() => {
    if (feedMeta.error) return { label: 'DEGRADED', tone: 'amber' as const };
    if (feedMeta.source === 'fixture') return { label: 'FIXTURE', tone: 'fixture' as const };
    if (feedMeta.stale) return { label: 'STALE CACHE', tone: 'amber' as const };
    return { label: 'CONNECTED', tone: 'green' as const };
  }, [feedMeta]);

  return (
    <header className="relative z-30 flex h-[62px] shrink-0 items-center gap-3 border-b border-holo-glow/20 bg-[rgb(5,11,23)] px-3">
      {/* Olympuss project context + Sign Out (restrained, gold) */}
      <ProjectSignOut />

      <div className="h-8 w-px bg-[#d6a13a]/20" />

      {/* System status with animated pulse */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${
              connectionState.tone === 'green' ? 'bg-alert-green' : 'bg-alert-amber'
            }`}
          />
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              connectionState.tone === 'green' ? 'bg-alert-green' : 'bg-alert-amber'
            }`}
          />
        </span>
        <span
          className={`font-mono text-[11px] font-semibold tracking-[0.18em] ${
            connectionState.tone === 'green' ? 'text-alert-green' : 'text-alert-amber'
          }`}
        >
          {connectionState.label}
        </span>
      </div>

      {/* Metrics cluster */}
      <div className="ml-1 flex items-center gap-4">
        <Metric label="India Time" value={clock} />
        <Metric label="Last GPS Update" value={formatRelativeAge(feedMeta.lastFetchAt)} />
        <Metric
          label="Live Buses"
          value={<CountUp value={buses.length} className="text-holo-glow" />}
        />
        <Metric
          label="Visible"
          value={<CountUp value={visibleCount} className="text-holo-teal" />}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* The core labelling affordance: live data vs predictive layer */}
        <div className="mr-1 flex shrink-0 items-center gap-2">
          <Badge variant={feedMeta.source === 'fixture' ? 'fixture' : 'live'} pulse>
            {feedMeta.source === 'fixture' ? LIVE_LABELS.fixture : LIVE_LABELS.gps}
          </Badge>
          <span className="inline-flex whitespace-nowrap items-center gap-1.5 rounded border border-holo-teal/45 bg-holo-teal/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-holo-teal">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-holo-teal" />
            Predictive Engine Active
          </span>
        </div>

        <button type="button" className="hud-button whitespace-nowrap" onClick={() => toggleAudit()}>
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          Audit
        </button>
        <button type="button" className="hud-button whitespace-nowrap" onClick={() => toggleDiagnostics()}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Diagnostics
        </button>
        <button type="button" className="hud-button whitespace-nowrap" onClick={() => toggleScenarioLab()}>
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          Scenario Lab
        </button>
        <button
          type="button"
          className="hud-button-primary whitespace-nowrap"
          onClick={openFleetDistribution}
          data-testid="open-fleet-distribution"
        >
          <Scale className="h-3.5 w-3.5" aria-hidden />
          Fleet Distribution
        </button>
        <button
          type="button"
          className="hud-button whitespace-nowrap"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="leading-tight">
      <div className="hud-label whitespace-nowrap">{label}</div>
      <div className="whitespace-nowrap font-mono text-xs tabular-nums text-holo-glow/90">
        {value}
      </div>
    </div>
  );
}
