// @vitest-environment node
//
// The rollout-stage posture rules the admin console renders, and the one
// cross-service copy they depend on.
//
// A rollout stage is the mechanism that keeps commands off unpromoted
// corridors. The web app does not enforce it — the control service does, in
// control-service/src/pilot/gate.ts — so everything the admin console says
// about a stage is a CLAIM ABOUT ANOTHER SERVICE'S BEHAVIOUR. The two share no
// code and no database, which makes the claim a copy; the last test here is
// what stops that copy drifting into a confident lie.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROLLOUT_STAGE_ORDER,
  STAGES_FORBIDDING_COMMANDS,
  DEFAULT_ROLLOUT_STAGE,
  permitsCommands,
  stageRank,
  stageChangeDirection,
  withdrawsCommandAuthority,
  ROLLOUT_STAGE_LABEL,
  ROLLOUT_STAGE_MEANING,
} from '@/lib/ops/rolloutPosture';
import { rolloutStageSchema, type RolloutStage } from '@/models/control';

const ALL_STAGES = rolloutStageSchema.options as readonly RolloutStage[];

describe('the stage scale', () => {
  it('covers every stage the wire schema allows, weakest first', () => {
    expect([...ROLLOUT_STAGE_ORDER]).toEqual([
      'observation',
      'shadow',
      'advisory',
      'limited_auto',
      'expanded',
    ]);
    expect([...ROLLOUT_STAGE_ORDER].sort()).toEqual([...ALL_STAGES].sort());
  });

  it('labels and explains every stage, so no corridor can render as a bare enum', () => {
    for (const stage of ALL_STAGES) {
      expect(ROLLOUT_STAGE_LABEL[stage], stage).toBeTruthy();
      expect(ROLLOUT_STAGE_MEANING[stage], stage).toBeTruthy();
    }
  });

  it('defaults an unset corridor to the SAFE end of the scale', () => {
    // Not a tidiness point: a corridor nobody has staged must refuse commands,
    // not permit them. Mirrors DEFAULT_ROLLOUT_STAGE in
    // control-service/src/pilot/rolloutStages.ts.
    expect(DEFAULT_ROLLOUT_STAGE).toBe('observation');
    expect(permitsCommands(DEFAULT_ROLLOUT_STAGE)).toBe(false);
    expect(stageRank(DEFAULT_ROLLOUT_STAGE)).toBe(0);
  });
});

describe('which stages permit commands', () => {
  it.each([
    ['observation', false],
    ['shadow', false],
    ['advisory', true],
    ['limited_auto', true],
    ['expanded', true],
  ] as const)('%s -> %s', (stage, permitted) => {
    expect(permitsCommands(stage)).toBe(permitted);
  });

  it('is a contiguous cut of the scale, not an arbitrary set', () => {
    // If a future stage were ever inserted such that a permitting stage sat
    // below a forbidding one, "advisory and above" — which is what every
    // sentence on the admin console says — would stop being true.
    const permitting = ROLLOUT_STAGE_ORDER.map(permitsCommands);
    const firstPermitting = permitting.indexOf(true);
    expect(firstPermitting).toBeGreaterThan(-1);
    expect(permitting.slice(firstPermitting).every(Boolean)).toBe(true);
  });
});

describe('the direction of a change', () => {
  it('reads promotion, demotion and a deliberate re-stamp of the same stage', () => {
    expect(stageChangeDirection('observation', 'advisory')).toBe('promotion');
    expect(stageChangeDirection('expanded', 'shadow')).toBe('demotion');
    // Not a no-op: re-setting the same stage is how a reason gets re-stamped,
    // and the endpoint accepts it.
    expect(stageChangeDirection('advisory', 'advisory')).toBe('unchanged');
  });

  it('flags exactly the demotions that stop commands reaching drivers', () => {
    // The transition the console must never make casual.
    expect(withdrawsCommandAuthority('advisory', 'shadow')).toBe(true);
    expect(withdrawsCommandAuthority('expanded', 'observation')).toBe(true);
    // A demotion that changes no authority. Still a demotion, still audited,
    // but nothing stops working — so it must not wear the same warning.
    expect(withdrawsCommandAuthority('expanded', 'advisory')).toBe(false);
    // Promotions and no-ops never withdraw anything.
    expect(withdrawsCommandAuthority('observation', 'advisory')).toBe(false);
    expect(withdrawsCommandAuthority('shadow', 'shadow')).toBe(false);
  });
});

describe('the copy of the control service’s own rule', () => {
  it('still agrees with control-service/src/models/pilotSchemas.ts', () => {
    // THE POINT OF THIS FILE. The admin console tells an operator which
    // corridors can and cannot receive commands. That sentence is only true
    // while this list matches the one the gate actually consults; the two
    // services share no code, so nothing but this test connects them.
    const source = readFileSync(
      path.join(process.cwd(), 'control-service/src/models/pilotSchemas.ts'),
      'utf8',
    );
    const match = /ROLLOUT_STAGES_FORBIDDING_COMMANDS[^=]*=\s*\[([^\]]*)\]/.exec(source);
    expect(match, 'ROLLOUT_STAGES_FORBIDDING_COMMANDS not found in the control service').not.toBeNull();

    const theirs = [...(match![1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(theirs).toEqual([...STAGES_FORBIDDING_COMMANDS]);
  });

  it('still agrees with the control service on the default stage', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'control-service/src/pilot/rolloutStages.ts'),
      'utf8',
    );
    const match = /DEFAULT_ROLLOUT_STAGE[^=]*=\s*'([a-z_]+)'/.exec(source);
    expect(match, 'DEFAULT_ROLLOUT_STAGE not found in the control service').not.toBeNull();
    expect(match![1]).toBe(DEFAULT_ROLLOUT_STAGE);
  });
});
