import Link from 'next/link';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import {
  OpsAlert,
  OpsGrid,
  OpsPanel,
  OpsReadout,
  OpsSection,
  OpsStack,
  OpsStat,
  OpsStatGroup,
  OpsStatStrip,
  opsButtonClass,
} from '@/components/ops/ui';
import { readingDisplay } from '@/lib/ops/consoleReadings';
import { buildAdminConsoleModel } from '@/lib/ops/adminConsoleModel';
import { readAdminConsoleFacts } from '@/lib/ops/adminConsoleData';
import { ROLLOUT_STAGE_LABEL, ROLLOUT_STAGE_ORDER, permitsCommands } from '@/lib/ops/rolloutPosture';
import { OpsAdminRoleDriftPanel } from '@/components/ops/admin/OpsAdminRoleDriftPanel';

export const dynamic = 'force-dynamic';

/**
 * `/ops/admin` — the administrator's console.
 *
 * ─── WHY THIS PAGE EXISTS AT ALL ─────────────────────────────────────────
 *
 * It did not. For as long as the admin role has existed, this exact address
 * was a 404: the segment held a layout, `invites/` and `rollout-stages/`, and
 * no page. `src/lib/auth/landing.ts` carried a hard-coded detour so a signing-
 * in admin at least landed somewhere, which fixed the symptom for one entry
 * point and left the address broken for a trimmed URL, a bookmark, or the nav
 * itself. The detour is gone; this is the page.
 *
 * ─── WHAT AN ADMIN CONSOLE IS FOR ────────────────────────────────────────
 *
 * Not a dashboard. An admin drives nothing — they decide who may drive and
 * what the system is permitted to do to a live network. So the overview is the
 * standing state of exactly those controls, and, underneath, the short list of
 * things that are currently wrong with them. The two screens that do the work
 * (people, rollout stages) are one click away and unchanged in purpose.
 *
 * ─── AND WHY EVERY NUMBER IS DEGRADABLE ──────────────────────────────────
 *
 * Every reading here is a claim about a control. "0 corridors accept commands"
 * reads as a safely locked-down network and is what a dead control service
 * produces; "18 accounts" from an unreadable roster is worse still. The facts
 * are read with per-source health (src/lib/ops/adminConsoleData.ts) and
 * rendered through `consoleReadings`, so an unread source prints `n/a` and
 * says which source it was. See src/lib/ops/adminConsoleModel.ts.
 */
export default async function OpsAdminPage() {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it — see any other ops page for why that `!` was a 500
  // waiting for a mid-render role change.
  const session = await requireOpsRolePage('admin', '/ops/admin');

  const facts = await readAdminConsoleFacts();
  const model = buildAdminConsoleModel(facts);

  return (
    <OpsShell
      title="Admin"
      email={session.email}
      role="admin"
      variant="wide"
      subtitle="Who has access, what they may do, and what the network can see"
      statusStrip={
        <OpsStatStrip>
          {model.groups.map((group) => (
            <OpsStatGroup key={group.label} label={group.label}>
              {group.tiles.map((tile) => (
                <OpsStat
                  key={tile.label}
                  label={tile.label}
                  value={readingDisplay(tile.reading)}
                  unit={tile.unit}
                  hint={tile.reading.detail}
                  tone={tile.tone}
                />
              ))}
            </OpsStatGroup>
          ))}
        </OpsStatStrip>
      }
    >
      <OpsStack>
        {model.unreadable.length > 0 && (
          <OpsAlert tone="warning" title="Some of this console could not be read">
            {model.unreadable.join(', ')} did not answer, so those readings show{' '}
            <span className="font-mono">n/a</span> rather than a number. Nothing above is a
            measured zero.
          </OpsAlert>
        )}

        <OpsSection
          title="Needs an administrator"
          description="Conditions only somebody with this role can clear. An empty list is the correct state, not a missing one."
        >
          {model.attention.length === 0 ? (
            <OpsAlert tone="success">
              Nothing is waiting on an administrator: every active operator has the assignments
              their role needs, no invite has expired unaccepted, and command authority is set.
            </OpsAlert>
          ) : (
            <OpsStack gap="tight">
              {model.attention.map((item) => (
                <OpsAlert
                  key={item.id}
                  tone={item.tone === 'error' ? 'error' : item.tone === 'warning' ? 'warning' : 'info'}
                  title={item.title}
                >
                  <p>{item.detail}</p>
                  {item.href && (
                    <Link
                      href={item.href}
                      className="mt-2 inline-block text-xs uppercase tracking-[0.14em] text-holo-glow underline-offset-4 hover:underline"
                    >
                      Open the screen that fixes it
                    </Link>
                  )}
                </OpsAlert>
              ))}
            </OpsStack>
          )}
        </OpsSection>

        <OpsSection title="Access integrity">
          <OpsAdminRoleDriftPanel />
        </OpsSection>

        <OpsGrid columns={2}>
          <OpsPanel
            title="Command authority by corridor"
            description="A rollout stage is a safety posture, not a display value: observation and shadow refuse every command outright."
            actions={
              <Link href="/ops/admin/rollout-stages" className={opsButtonClass('quiet')}>
                Manage stages
              </Link>
            }
          >
            {!facts.rollout.ok ? (
              <OpsAlert tone="warning">
                The control service did not answer, so the current posture of every corridor is
                unknown here. It has not changed — this console simply cannot read it.
              </OpsAlert>
            ) : (
              <OpsStack gap="tight">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {ROLLOUT_STAGE_ORDER.map((stage) => (
                    <OpsReadout
                      key={stage}
                      label={ROLLOUT_STAGE_LABEL[stage]}
                      value={facts.rollout.byStage[stage]}
                      tone={
                        facts.rollout.byStage[stage] === 0
                          ? 'default'
                          : permitsCommands(stage)
                            ? 'accent'
                            : 'default'
                      }
                    />
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-ops-faint">
                  Cyan stages permit commands. Every corridor at observation or shadow refuses
                  them and records a guardrail breach for the attempt, so a corridor sitting there
                  is not merely unmonitored — it is closed.
                </p>
              </OpsStack>
            )}
          </OpsPanel>

          <OpsPanel
            title="What the network can detect"
            description="Corridors with mapped geometry, and the subset carrying a real measured target headway."
            actions={
              <Link href="/ops/admin/network" className={opsButtonClass('quiet')}>
                Corridor coverage
              </Link>
            }
          >
            <OpsStack gap="tight">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {/* Read straight off the facts rather than fished back out of
                    the tile list: `n/a` here has to mean the same thing it
                    means in the strip, and the only way to guarantee that is
                    for both to come from the same source health flag. */}
                <OpsReadout
                  label="Mapped"
                  value={facts.network.ok ? facts.network.mapped : 'n/a'}
                />
                <OpsReadout
                  label="Can detect bunching"
                  value={
                    facts.network.ok && facts.network.detecting !== null
                      ? facts.network.detecting
                      : 'n/a'
                  }
                  tone="accent"
                />
              </div>
              {model.coverageNotice ? (
                <p className="text-xs leading-relaxed text-ops-faint">{model.coverageNotice}</p>
              ) : (
                <p className="text-xs leading-relaxed text-ops-faint">
                  The control service did not answer, so coverage could not be counted at all.
                </p>
              )}
            </OpsStack>
          </OpsPanel>
        </OpsGrid>

        <OpsPanel
          title="Two assignments only an administrator can make"
          description="Both fail closed by design. Read this before treating either as a broken form."
        >
          <OpsStack gap="tight">
            <p className="text-sm leading-relaxed text-ops-muted">
              <span className="text-ops-ink">Depot.</span> A depot operator sees only their own
              depot&apos;s vehicles, and the scope is applied on the server before any fleet data is
              sent. An operator with no depot is refused outright rather than shown the statewide
              fleet, because the fallback that looks helpful is the one that leaks 143 depots&apos;
              vehicles to whoever was configured last.
            </p>
            <p className="text-sm leading-relaxed text-ops-muted">
              <span className="text-ops-ink">Vehicle.</span> A driver&apos;s assigned vehicle
              decides which instruction stream reaches them. If a driver could set their own, they
              could redirect another vehicle&apos;s commands to their cab — so the write path is
              admin-only, and a driver-supplied vehicle id is never trusted as a fallback.
            </p>
            <Link href="/ops/admin/invites" className={opsButtonClass('default', 'self-start')}>
              Manage people and assignments
            </Link>
          </OpsStack>
        </OpsPanel>
      </OpsStack>
    </OpsShell>
  );
}
