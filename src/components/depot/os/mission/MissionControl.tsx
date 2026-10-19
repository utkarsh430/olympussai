'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, Bot, Building2, FileText } from 'lucide-react';
import { useNetworkHourly } from '@/hooks/useNetworkHourly';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount, formatFeedTime } from '@/lib/depot/format';
import { EXCEPTIONS_PATH, INCIDENTS_PATH, REBALANCE_PATH } from '@/lib/depot/nav';
import { buildBriefing } from '@/lib/depot/os/intel/briefing';
import { regionById } from '@/lib/depot/os/regions';
import { DECISIONS_PATH, OVERVIEW_PATH, RELIABILITY_PATH } from '@/lib/depot/os/workspaces';
import { useIntel } from '../IntelProvider';
import { ActivityPanel, AiPulse } from '../ai/AiPulse';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { DecisionPanel } from '../decisions/DecisionPanel';
import { DecisionQueue } from '../decisions/DecisionQueue';
import { SituationMap, type MapDepot, type MapIncident, type MapTransfer } from '../map/SituationMap';
import { Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';
import { ActivityTimeline, type TimelineEvent } from './ActivityTimeline';
import { StateMixBar } from '../StateMixBar';

/**
 * Headquarters Mission Control: the network (or the chosen region) at a glance — fleet
 * telemetry, the situation map, the AI's ranked decisions with the selected one opened in
 * its seven parts, today's activity line and the automated briefing.
 */
export function MissionControl() {
  const intel = useIntel();
  const regionId = useOsStore((s) => s.regionId);
  const openEntity = useOsStore((s) => s.openEntity);
  const askCopilot = useOsStore((s) => s.askCopilot);
  const region = regionById(regionId);
  const scopeLabel = region ? `${region.name} region` : 'UPSRTC network';
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [selectedDepot, setSelectedDepot] = useState<string | null>(null);
  const hourly = useNetworkHourly({ band: null, depotId: null, page: 1 });

  const depots = useMemo(
    () => (intel.network?.depots ?? []).filter((d) => intel.scope === null || intel.scope.has(d.id)),
    [intel.network, intel.scope],
  );
  const totals = useMemo(() => {
    const sum = (pick: (d: (typeof depots)[number]) => number): number => depots.reduce((s, d) => s + pick(d), 0);
    return {
      fleet: sum((d) => d.fleet),
      onRoad: sum((d) => d.states.inService + d.states.onRoad),
      standing: sum((d) => d.states.standing),
      dark: sum((d) => d.states.dark),
      offRoad: sum((d) => d.states.offRoad),
      reporting: sum((d) => d.reporting),
    };
  }, [depots]);
  const balances = useMemo(() => new Map((intel.distribution?.balances ?? []).map((b) => [b.depotId, b])), [intel.distribution]);
  const shortage = useMemo(
    () =>
      [...balances.values()]
        .filter((b) => b.kind === 'depot' && b.balance < 0 && (intel.scope === null || intel.scope.has(b.depotId)))
        .reduce((s, b) => s + -b.balance, 0),
    [balances, intel.scope],
  );
  const incidents = useMemo(
    () => (intel.incidents?.rows ?? []).filter((r) => intel.scope === null || intel.scope.has(r.depotId)),
    [intel.incidents, intel.scope],
  );
  const decisionsByDepot = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of intel.decisions) if (d.depotId) m.set(d.depotId, (m.get(d.depotId) ?? 0) + 1);
    return m;
  }, [intel.decisions]);

  const mapDepots = useMemo<MapDepot[]>(
    () =>
      depots
        .filter((d) => d.kind === 'depot')
        .map((d) => ({
          id: d.id,
          name: d.name,
          position: balances.get(d.id)?.position ?? d.centroid,
          fleet: d.fleet,
          balance: balances.get(d.id)?.balance ?? null,
          decisions: decisionsByDepot.get(d.id) ?? 0,
        })),
    [depots, balances, decisionsByDepot],
  );
  const transfers = useMemo<MapTransfer[]>(() => {
    const plan = intel.distribution?.plan;
    if (!plan) return [];
    return plan.transfers
      .filter((t) => intel.scope === null || intel.scope.has(t.fromDepotId) || intel.scope.has(t.toDepotId))
      .flatMap((t) => {
        const from = balances.get(t.fromDepotId)?.position;
        const to = balances.get(t.toDepotId)?.position;
        return from && to ? [{ id: t.id, from, to, buses: t.buses }] : [];
      });
  }, [intel.distribution, intel.scope, balances]);
  const incidentMarks = useMemo<MapIncident[]>(() => {
    const byReg = new Map((intel.fleet ?? []).map((b) => [b.registration, b]));
    return incidents.flatMap((r) => {
      const bus = byReg.get(r.registrationNumber);
      return bus && bus.lat !== null && bus.lng !== null
        ? [{ id: r.registrationNumber, position: { lat: bus.lat, lng: bus.lng }, label: `${r.registrationNumber}: possible breakdown` }]
        : [];
    });
  }, [incidents, intel.fleet]);

  const decision = intel.decisions.find((d) => d.id === selectedDecision) ?? intel.decisions[0] ?? null;
  const briefing = useMemo(
    () => buildBriefing({ scopeLabel, depots, decisions: intel.decisions, health: intel.health?.filter((h) => intel.scope === null || (h.depotId !== null && intel.scope.has(h.depotId))) ?? null, fuel: intel.fuel }),
    [scopeLabel, depots, intel.decisions, intel.health, intel.scope, intel.fuel],
  );

  const currentHour = hourly.data?.currentHour ?? null;
  const events = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];
    const topShortage = intel.decisions.find((d) => d.category === 'shortage');
    if (shortage > 0) list.push({ id: 'peak-shortage', hour: 6, endHour: 10, label: `Peak shortage ${formatCount(shortage)} buses`, tone: 'crimson', decisionId: topShortage?.id });
    if (incidents.length > 0 && currentHour !== null) {
      const top = intel.decisions.find((d) => d.category === 'incident');
      list.push({ id: 'incidents', hour: currentHour, label: `${formatCount(incidents.length)} suspected breakdowns`, tone: 'crimson', decisionId: top?.id });
    }
    const evening = hourly.data?.bands.find((b) => b.band === 'evening_peak');
    if (evening && evening.busesShort > 0) list.push({ id: 'evening', hour: 16, endHour: 20, label: `Evening: ${formatCount(evening.shortRoutes)} routes short`, tone: 'amber' });
    const redistribution = intel.decisions.find((d) => d.category === 'redistribution');
    if (redistribution) list.push({ id: 'transfers', hour: 21, endHour: 23.5, label: `Reposition ${formatCount(redistribution.weight)} buses`, tone: 'teal', decisionId: redistribution.id });
    const maintenance = intel.decisions.find((d) => d.category === 'maintenance');
    if (maintenance) list.push({ id: 'workshop', hour: 12, endHour: 15, label: 'Workshop: inspect high-risk buses', tone: 'amber', decisionId: maintenance.id });
    return list;
  }, [intel.decisions, shortage, incidents.length, currentHour, hourly.data]);

  const selected = selectedDepot ? (depots.find((d) => d.id === selectedDepot) ?? null) : null;
  const selectedBalance = selected ? balances.get(selected.id) : undefined;

  return (
    <div className="space-y-4" data-testid="os-mission-control">
      <OsHeader
        title="Mission Control"
        description={`${scopeLabel}: what is happening, what is likely to happen, and what the AI recommends.`}
        statuses={['live', 'estimate', 'proposed']}
        actions={
          <>
            <span className="font-mono text-[11px] text-depot-muted">
              Feed clock {formatFeedTime(intel.network?.feedNow ?? null)}
            </span>
            <button type="button" onClick={() => askCopilot(`What needs attention at the ${region ? `${region.name} region` : 'network'}?`)} className="os-button os-button-quiet">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              Brief me
            </button>
            <Link href={DECISIONS_PATH} className="os-button">
              AI Decision Center
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </>
        }
      />

      {!intel.network ? (
        <PanelLoading rows={2} label="Loading network telemetry" />
      ) : (
        <MetricStrip columns={8}>
          <Metric label="Total fleet" value={formatCount(totals.fleet)} sub={`${formatCount(depots.length)} units`} status="live" href={OVERVIEW_PATH} testId="os-kpi-fleet" />
          <Metric label="Available" value={formatCount(totals.fleet - totals.offRoad)} sub="Fleet less off-road" href={OVERVIEW_PATH} />
          <Metric label="On road" value={formatCount(totals.onRoad)} sub={`${totals.fleet > 0 ? Math.round((totals.onRoad / totals.fleet) * 100) : 0}% of fleet`} tone="green" href={OVERVIEW_PATH} />
          <Metric label="Standing" value={formatCount(totals.standing)} tone="amber" sub="Heard, not moving" href={OVERVIEW_PATH} />
          <Metric label="Dark telemetry" value={formatCount(totals.dark)} sub="No GPS signal" href={EXCEPTIONS_PATH} />
          <Metric label="Off road" value={formatCount(totals.offRoad)} tone="crimson" sub="Flagged maintenance" href={RELIABILITY_PATH} />
          <Metric label="Peak shortage" value={intel.distribution ? formatCount(shortage) : '—'} sub="Buses short, morning peak" tone={shortage > 0 ? 'crimson' : 'green'} status="estimate" href={REBALANCE_PATH} />
          <Metric label="Suspected breakdowns" value={intel.incidents ? formatCount(incidents.length) : '—'} sub="Detected from the feed" tone={incidents.length > 0 ? 'crimson' : null} href={INCIDENTS_PATH} />
        </MetricStrip>
      )}

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          kicker="Situation"
          title={`Network map · ${scopeLabel}`}
          actions={<StatusTag status="live" />}
          bodyClassName="p-0"
          strong
        >
          <div className="relative">
            <SituationMap
              depots={mapDepots}
              transfers={transfers}
              incidents={incidentMarks}
              selectedId={selectedDepot}
              onSelect={setSelectedDepot}
              availableLayers={['pressure', 'transfers', 'incidents']}
              heightClass="h-[482px] rounded-none border-0"
            />
            {selected ? (
              <div className="absolute bottom-3 right-3 z-10 w-72 rounded-md border border-holo-glow/35 bg-depot-page/95 p-3 backdrop-blur" data-testid="os-map-selection">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-sans text-[14px] font-semibold text-depot-ink">{selected.name}</div>
                    <div className="font-mono text-[11px] text-depot-muted">{formatCount(selected.fleet)} buses</div>
                  </div>
                  <button type="button" onClick={() => setSelectedDepot(null)} className="font-sans text-[11px] text-depot-muted hover:text-depot-ink">
                    Clear
                  </button>
                </div>
                <div className="mt-2">
                  <StateMixBar states={selected.states} fleet={selected.fleet} />
                </div>
                {selectedBalance ? (
                  <div className={`mt-2 font-sans text-[12px] ${selectedBalance.balance < 0 ? 'text-alert-crimson' : 'text-depot-prose'}`}>
                    {selectedBalance.balance < 0
                      ? `${formatCount(-selectedBalance.balance)} short at the morning peak`
                      : `${formatCount(selectedBalance.balance)} above peak need`}
                    {' · '}
                    {formatCount(decisionsByDepot.get(selected.id) ?? 0)} open decisions
                  </div>
                ) : null}
                <div className="mt-2.5 flex gap-2">
                  <button type="button" onClick={() => openEntity({ kind: 'depot', id: selected.id })} className="os-button os-button-quiet py-1 text-[11.5px]">
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                    Profile
                  </button>
                  <Link href={depotHref(selected.id)} className="os-button py-1 text-[11.5px]">
                    Depot Mission Control
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          kicker="AI priority intelligence"
          title={`${formatCount(intel.decisions.length)} decisions ranked`}
          actions={<Link href={DECISIONS_PATH} className="depot-link font-sans text-[12px]">All</Link>}
          className="h-[540px]"
          bodyClassName="flex min-h-0 flex-col"
          testId="os-priority-panel"
        >
          <DecisionQueue
            decisions={intel.decisions}
            selectedId={decision?.id ?? null}
            onSelect={setSelectedDecision}
            loading={!intel.ready}
            maxItems={12}
          />
        </Panel>
      </div>

      <Panel kicker="Today" title="Network activity and pressure" bodyClassName="p-0">
        <ActivityTimeline
          bands={hourly.data?.bands ?? null}
          currentHour={currentHour}
          events={events}
          onSelectDecision={setSelectedDecision}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <ActivityPanel depotId={null} />
        <AiPulse depotId={null} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel kicker="AI decision" title="Selected decision" strong bodyClassName="p-0">
          <DecisionPanel decision={decision} />
        </Panel>
        <Panel
          kicker="Automated briefing"
          title={briefing.headline}
          actions={<FileText className="h-4 w-4 text-depot-muted" aria-hidden />}
          bodyClassName="space-y-2 p-4"
          testId="os-briefing"
        >
          {briefing.situation.map((line) => (
            <p key={line} className="depot-note">
              {line}
            </p>
          ))}
          <ol className="space-y-1.5 pt-1">
            {briefing.priorities.map((p) => (
              <li key={p.decisionId}>
                <button type="button" onClick={() => setSelectedDecision(p.decisionId)} className="text-left font-sans text-[12px] leading-4 text-depot-prose hover:text-holo-glow">
                  {p.text}
                </button>
              </li>
            ))}
          </ol>
          <p className="font-sans text-[12px] font-medium text-holo-teal">{briefing.outlook}</p>
        </Panel>
      </div>
    </div>
  );
}
