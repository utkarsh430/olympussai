import Link from 'next/link';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import {
  OpsAlert,
  OpsEmptyState,
  OpsPanel,
  OpsStack,
  OpsStat,
  OpsStatStrip,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';
import { readAdminCorridors, type AdminCorridor } from '@/lib/ops/adminConsoleData';
import {
  DEFAULT_ROLLOUT_STAGE,
  ROLLOUT_STAGE_LABEL,
  permitsCommands,
} from '@/lib/ops/rolloutPosture';

export const dynamic = 'force-dynamic';

/** Which slice of the corridor list to show. Rides in the URL so it is linkable. */
const FILTERS = ['detecting', 'observation-only', 'all'] as const;
type CorridorFilter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<CorridorFilter, string> = {
  detecting: 'Can detect bunching',
  'observation-only': 'Observation-only',
  all: 'Every mapped corridor',
};

function filterFrom(value: string | undefined): CorridorFilter {
  return FILTERS.includes(value as CorridorFilter) ? (value as CorridorFilter) : 'observation-only';
}

/**
 * `/ops/admin/network` — how much of the network can actually tell this system
 * anything, and which corridors cannot.
 *
 * ─── WHY AN ADMIN SCREEN, AND NOT A CONTROL-ROOM ONE ─────────────────────
 *
 * The control room already shows the coverage PAIR, because an operator
 * reading a corridor needs to know whether silence means "nothing is wrong" or
 * "this corridor cannot report". What it deliberately does not show is the
 * LIST — which specific corridors are observation-only — because that is not a
 * shift-time decision. It is a provisioning fact, and the person who acts on
 * it is the administrator: it is the input to which corridors are worth staging
 * past observation at all.
 *
 * ─── THE HONESTY CLAIM THIS SCREEN MUST NOT UNDO ─────────────────────────
 *
 * The route network was seeded from real geometry, and only some of it carries
 * a real measured target headway. The rest carries an honest sentinel and can
 * detect nothing. None of it is fabricated, and no surface may round that up:
 * "mapped" is not "covered", and the count of mapped corridors is not the size
 * of the network — the control database holds only what has been mapped so
 * far. The caption under the numbers says exactly that, on this screen and on
 * the control room's, in the same words.
 */
export default async function OpsAdminNetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const session = await requireOpsRolePage('admin', '/ops/admin/network');
  const { show } = await searchParams;
  const filter = filterFrom(show);

  return (
    <OpsShell
      title="Admin · Network"
      email={session.email}
      role="admin"
      variant="wide"
      subtitle="Corridor coverage: what has been mapped, and what can actually detect"
    >
      <NetworkBody filter={filter} />
    </OpsShell>
  );
}

/**
 * The data read, inside its own async component so a control-service failure
 * renders an alert and leaves the chrome and navigation intact — the rule every
 * ops dashboard follows (docs/olympuss/OPS_DESIGN_SYSTEM.md).
 */
async function NetworkBody({ filter }: { filter: CorridorFilter }) {
  const snapshot = await readAdminCorridors();

  if (!snapshot.ok) {
    return (
      <OpsAlert tone="error" title="Corridor coverage could not be read">
        The control service did not answer{snapshot.error ? ` (${snapshot.error})` : ''}, so this
        screen has no corridor list to show. Nothing about the network has changed — this console
        cannot see it. Try again shortly.
      </OpsAlert>
    );
  }

  const detecting = snapshot.corridors.filter((c) => c.detects === true);
  const observationOnly = snapshot.corridors.filter((c) => c.detects === false);
  const unknown = snapshot.corridors.filter((c) => c.detects === null);

  const shown =
    filter === 'detecting' ? detecting : filter === 'observation-only' ? observationOnly : snapshot.corridors;

  return (
    <OpsStack>
      <OpsStatStrip className="rounded-md border border-ops-line px-4">
        <OpsStat
          label="Corridors mapped"
          value={snapshot.mapped}
          hint="have geometry in the control database"
        />
        <OpsStat
          label="Can detect bunching"
          value={snapshot.detecting === null ? 'n/a' : snapshot.detecting}
          unit={snapshot.detecting === null ? undefined : `of ${snapshot.mapped}`}
          tone="accent"
          hint={
            snapshot.detecting === null
              ? 'this control service does not report headway policies'
              : 'carry a real measured target headway'
          }
        />
        <OpsStat
          label="Observation-only"
          value={snapshot.detecting === null ? 'n/a' : observationOnly.length}
          hint="carry an honest sentinel and will report nothing"
        />
      </OpsStatStrip>

      <OpsAlert tone="info" title="What these two numbers are, and are not">
        A mapped corridor has real geometry and can be selected anywhere in the console. Only a
        corridor with a real measured target headway can compare vehicles against a schedule and
        report bunching; the rest carry an honest sentinel instead of an invented target, so they
        show nothing rather than something wrong. None of this network is fabricated. And{' '}
        <span className="text-ops-ink">
          the control database holds only the corridors mapped so far, so the size of the full
          network is not known here
        </span>{' '}
        — this is not a whole-network view.
      </OpsAlert>

      {snapshot.stagesMissing && (
        <OpsAlert tone="warning">
          Corridor names and rollout stages come from a second read that did not answer, so those
          two columns are blank below. The coverage counts above came from the corridor list itself
          and are unaffected.
        </OpsAlert>
      )}

      {unknown.length > 0 && (
        <OpsAlert tone="warning">
          {unknown.length} of {snapshot.mapped} corridors did not say whether they carry a headway
          policy. They are counted as neither detecting nor observation-only, because assuming
          either would be a guess.
        </OpsAlert>
      )}

      <OpsPanel
        title={FILTER_LABEL[filter]}
        description="Observation-only is the default view: it is the list an administrator can act on."
        actions={
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <Link
                key={option}
                href={`/ops/admin/network?show=${option}`}
                aria-current={option === filter ? 'true' : undefined}
                className={
                  option === filter
                    ? 'rounded border border-holo-glow/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-holo-glow'
                    : 'rounded border border-ops-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ops-muted hover:border-holo-glow/60 hover:text-holo-glow'
                }
              >
                {FILTER_LABEL[option]}
              </Link>
            ))}
          </div>
        }
        padded={false}
      >
        {shown.length === 0 ? (
          <div className="p-4">
            <OpsEmptyState>
              {filter === 'observation-only'
                ? 'Every mapped corridor carries a measured target headway — there are none that can only be observed.'
                : filter === 'detecting'
                  ? 'No mapped corridor carries a measured target headway yet, so nothing on this network can report bunching.'
                  : 'The control service reports no mapped corridors at all.'}
            </OpsEmptyState>
          </div>
        ) : (
          <CorridorTable corridors={shown} />
        )}
      </OpsPanel>
    </OpsStack>
  );
}

function CorridorTable({ corridors }: { corridors: readonly AdminCorridor[] }) {
  return (
    <OpsTableFrame className="rounded-none border-0">
      <table className={opsTableClass}>
        <thead>
          <tr className={opsTheadRowClass}>
            <th className={opsThClass}>Corridor</th>
            <th className={opsThClass}>Direction</th>
            <th className={opsThClass}>Detection</th>
            <th className={opsThClass}>Rollout stage</th>
            <th className={opsThClass}>Commands</th>
          </tr>
        </thead>
        <tbody>
          {corridors.map((corridor) => {
            // An unstaged corridor is not an unknown one: the control service
            // treats a missing row as 'observation', which is the closed end of
            // the scale. Rendering it as blank would hide a real posture.
            const stage = corridor.stage ?? DEFAULT_ROLLOUT_STAGE;
            return (
              <tr key={corridor.routeDirectionId} className={opsTrClass}>
                <td className={opsTdClass}>
                  {corridor.publicName ?? (
                    <span className="text-ops-faint">unnamed</span>
                  )}
                  <span className="ml-2 font-mono text-[11px] text-ops-faint">
                    {corridor.routeId}
                  </span>
                </td>
                <td className={opsTdMutedClass}>{corridor.directionCode}</td>
                {/* Deliberately NOT an OpsBadge. `live`/`sim`/`fixture` are
                    this product's provenance vocabulary — observed data versus
                    modelled data — and detection capability is a different
                    question entirely. Borrowing the green chip for it would put
                    a second meaning on the one signal the whole console's
                    honesty claim rests on. */}
                <td className={opsTdClass}>
                  {corridor.detects === true ? (
                    <span className="text-ops-good">measured headway</span>
                  ) : corridor.detects === false ? (
                    <span className="text-ops-muted">observation only</span>
                  ) : (
                    <span className="text-ops-faint">not reported</span>
                  )}
                </td>
                <td className={opsTdMutedClass}>
                  {ROLLOUT_STAGE_LABEL[stage]}
                  {corridor.stage === null && (
                    <span className="ml-1 text-ops-faint">(never staged)</span>
                  )}
                </td>
                <td className={opsTdMutedClass}>
                  {permitsCommands(stage) ? 'permitted' : 'refused'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </OpsTableFrame>
  );
}
