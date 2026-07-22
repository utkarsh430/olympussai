'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { X, RotateCcw, FlaskConical } from 'lucide-react';
import { useCopilotStore, useSelectedBus } from '@/stores/copilotStore';
import { buildScenario } from '@/lib/simulation/scenarioEngine';
import { TIME_WINDOWS, TIME_WINDOW_LABELS } from '@/lib/demo-scenarios/demandScenario';
import { cn } from '@/lib/utils';

/**
 * Presenter control surface for tuning projection inputs live.
 * Changing a control rebuilds the active scenario immediately.
 */
export function ScenarioLab() {
  const isOpen = useCopilotStore((state) => state.isScenarioLabOpen);
  const toggle = useCopilotStore((state) => state.toggleScenarioLab);
  const overrides = useCopilotStore((state) => state.overrides);
  const setOverrides = useCopilotStore((state) => state.setOverrides);
  const resetOverrides = useCopilotStore((state) => state.resetOverrides);
  const activeKind = useCopilotStore((state) => state.activeScenarioKind);
  const setScenario = useCopilotStore((state) => state.setScenario);
  const schedule = useCopilotStore((state) => state.schedule);
  const resetDemonstration = useCopilotStore((state) => state.resetDemonstration);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const bus = useSelectedBus();

  // Rebuild the live scenario whenever an override changes.
  useEffect(() => {
    if (!bus || !activeKind || activeKind === 'communication') return;
    const scenario = buildScenario(activeKind, { bus, schedule, overrides });
    setScenario(activeKind, scenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggle(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, toggle]);

  function handleReset() {
    resetOverrides();
    resetDemonstration();
    logAudit('demo-reset', 'Presenter reset the demonstration to default state');
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: 460, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 460, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="hud-panel-strong hud-corners fixed right-0 top-0 z-[96] flex h-full w-[440px] flex-col overflow-hidden"
          role="dialog"
          aria-label="Scenario laboratory"
          data-testid="scenario-lab"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-holo-glow/20 px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
                <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                Scenario Lab
              </h2>
              <p className="font-mono text-[9px] text-holo-glow/40">
                Presenter controls for projection inputs
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggle(false)}
              className="hud-button px-2 py-1"
              aria-label="Close scenario lab"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div className="flex items-center gap-2">
              <span className="rounded border border-holo-teal/45 bg-holo-teal/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-holo-teal">
                Predictive
              </span>
              {!bus && (
                <span className="font-mono text-[9px] text-alert-amber">Select a bus first</span>
              )}
            </div>

            <Group title="Bunching">
              <Slider
                label="Bunching risk"
                min={40}
                max={99}
                unit="%"
                value={overrides.bunchingRisk ?? 87}
                onChange={(value) => setOverrides({ bunchingRisk: value })}
              />
              <Slider
                label="Gap ahead"
                min={1}
                max={14}
                unit=" min"
                value={overrides.gapAheadMinutes ?? 3}
                onChange={(value) => setOverrides({ gapAheadMinutes: value })}
              />
              <Slider
                label="Gap behind"
                min={8}
                max={40}
                unit=" min"
                value={overrides.gapBehindMinutes ?? 24}
                onChange={(value) => setOverrides({ gapBehindMinutes: value })}
              />
              <Slider
                label="Hold duration"
                min={30}
                max={300}
                step={15}
                unit="s"
                value={overrides.holdSeconds ?? 90}
                onChange={(value) => setOverrides({ holdSeconds: value })}
              />
            </Group>

            <Group title="Traffic">
              <Choice
                label="Congestion severity"
                options={['moderate', 'heavy', 'severe'] as const}
                value={overrides.congestionSeverity ?? 'severe'}
                onChange={(value) => setOverrides({ congestionSeverity: value })}
              />
              <Slider
                label="Traffic delay"
                min={4}
                max={45}
                unit=" min"
                value={overrides.trafficDelayMinutes ?? 18}
                onChange={(value) => setOverrides({ trafficDelayMinutes: value })}
              />
              <Slider
                label="Distance ahead"
                min={1}
                max={12}
                step={0.2}
                unit=" km"
                decimals={1}
                value={overrides.congestionDistanceKm ?? 4.2}
                onChange={(value) => setOverrides({ congestionDistanceKm: value })}
              />
              <Slider
                label="Alternative saving"
                min={2}
                max={30}
                unit=" min"
                value={overrides.alternativeSavingMinutes ?? 12}
                onChange={(value) => setOverrides({ alternativeSavingMinutes: value })}
              />
            </Group>

            <Group title="Breakdown">
              <Choice
                label="Breakdown type"
                options={
                  [
                    'Engine overheating',
                    'Air-brake pressure loss',
                    'Transmission fault',
                    'Electrical system failure',
                  ] as const
                }
                value={overrides.breakdownType ?? 'Engine overheating'}
                onChange={(value) => setOverrides({ breakdownType: value })}
                stacked
              />
              <Slider
                label="Passengers onboard"
                min={8}
                max={70}
                value={overrides.passengerCount ?? 47}
                onChange={(value) => setOverrides({ passengerCount: value })}
              />
              <Slider
                label="Rescue candidates"
                min={1}
                max={5}
                value={overrides.rescueCandidateCount ?? 3}
                onChange={(value) => setOverrides({ rescueCandidateCount: value })}
              />
              <Slider
                label="Response time"
                min={4}
                max={40}
                unit=" min"
                value={overrides.responseTimeMinutes ?? 11}
                onChange={(value) => setOverrides({ responseTimeMinutes: value })}
              />
            </Group>

            <Group title="Demand">
              <Slider
                label="Demand multiplier"
                min={0.5}
                max={2.2}
                step={0.05}
                decimals={2}
                value={overrides.demandMultiplier ?? 1}
                onChange={(value) => setOverrides({ demandMultiplier: value })}
              />
              <Choice
                label="Peak window"
                options={TIME_WINDOWS}
                value={overrides.peakWindow ?? '08:00'}
                onChange={(value) => setOverrides({ peakWindow: value })}
                renderLabel={(option) => TIME_WINDOW_LABELS[option]}
              />
              <Toggle
                label="Festival surge"
                checked={overrides.festivalSurge ?? false}
                onChange={(checked) => setOverrides({ festivalSurge: checked })}
              />
              <Slider
                label="Reserve buses"
                min={0}
                max={12}
                value={overrides.reserveBuses ?? 3}
                onChange={(value) => setOverrides({ reserveBuses: value })}
              />
            </Group>

            <Group title="Communication">
              <Choice
                label="Message language"
                options={['en', 'hi', 'both'] as const}
                value={overrides.messageLanguage ?? 'both'}
                onChange={(value) => setOverrides({ messageLanguage: value })}
              />
              <Slider
                label="Acknowledgement delay"
                min={1}
                max={20}
                unit="s"
                value={overrides.acknowledgementDelaySeconds ?? 4}
                onChange={(value) => setOverrides({ acknowledgementDelaySeconds: value })}
              />
              <Slider
                label="Call duration"
                min={15}
                max={180}
                step={5}
                unit="s"
                value={overrides.callDurationSeconds ?? 55}
                onChange={(value) => setOverrides({ callDurationSeconds: value })}
              />
            </Group>
          </div>

          <footer className="shrink-0 border-t border-holo-glow/15 p-4">
            <button
              type="button"
              onClick={handleReset}
              className="hud-button-danger w-full py-2.5"
              data-testid="reset-demonstration"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reset Demonstration
            </button>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-holo-glow/15 bg-void-900/50 p-3">
      <h3 className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-holo-teal">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  unit = '',
  decimals = 0,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  decimals?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between">
        <span className="hud-label">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-holo-glow">
          {value.toFixed(decimals)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-holo-glow/20 accent-[#3ff0ff]"
      />
    </label>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  stacked,
  renderLabel,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  stacked?: boolean;
  renderLabel?: (option: T) => string;
}) {
  return (
    <div>
      <span className="hud-label mb-1 block">{label}</span>
      <div className={cn('gap-1', stacked ? 'grid grid-cols-2' : 'flex')} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={cn(
              'flex-1 truncate rounded border px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider transition',
              value === option
                ? 'border-holo-glow/70 bg-holo-glow/15 text-holo-glow'
                : 'border-holo-glow/15 text-holo-glow/45 hover:border-holo-glow/40',
            )}
          >
            {renderLabel ? renderLabel(option) : option}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between"
    >
      <span className="hud-label">{label}</span>
      <span
        className={cn(
          'relative h-4 w-8 rounded-full border transition',
          checked ? 'border-holo-glow/70 bg-holo-glow/25' : 'border-holo-glow/20 bg-void-900',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all',
            checked ? 'left-[18px] bg-holo-glow' : 'left-0.5 bg-holo-glow/35',
          )}
        />
      </span>
    </button>
  );
}
