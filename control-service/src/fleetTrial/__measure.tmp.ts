// TEMPORARY measurement harness - deleted before commit.
// Paired-by-seed comparison of the forecast-admission gate against the
// CURRENT 0.6 action bar, per corridor, with bootstrap intervals.
import { writeFileSync } from 'node:fs';
import { runFleetTrial, DEFAULT_FLEET_TRIAL_SPEC } from './run.js';
import type { CorridorPresetId } from './presets.js';

const SEEDS = Number(process.env.SEEDS ?? 12);
const VEHICLES = Number(process.env.VEHICLES ?? 500);
const CORRIDOR = (process.env.CORRIDOR ?? 'urban') as CorridorPresetId;

interface Obs { seed: number; offEwt: number; onEwt: number; offNet: number; onNet: number; offHolds: number; onHolds: number; }
const obs: Obs[] = [];

for (let i = 0; i < SEEDS; i++) {
  const seed = 20260906 + i * 104729;
  const report = runFleetTrial({
    ...DEFAULT_FLEET_TRIAL_SPEC,
    corridorPreset: CORRIDOR,
    vehiclesPerPhase: VEHICLES,
    seed,
  });
  const study = report.policyStudies.find((s) => s.knob === 'forecast_action_gate');
  if (!study) throw new Error('forecast_action_gate study missing');
  const off = study.rows.find((r) => r.label === 'off (deployed)');
  const on = study.rows.find((r) => r.label === 'on');
  if (!off || !on) throw new Error('rows missing');
  obs.push({
    seed,
    offEwt: off.ewtImprovementPercent ?? NaN,
    onEwt: on.ewtImprovementPercent ?? NaN,
    offNet: off.passengerSecondsSavedPercent ?? NaN,
    onNet: on.passengerSecondsSavedPercent ?? NaN,
    offHolds: off.holdCount,
    onHolds: on.holdCount,
  });
  console.error(`${CORRIDOR} seed ${i + 1}/${SEEDS} done`);
}

writeFileSync(`/tmp/claude-501/fg/${CORRIDOR}-paired.json`, JSON.stringify(obs, null, 2));
console.log(`${CORRIDOR}: ${obs.length} paired observations written`);
