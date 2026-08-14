import Link from 'next/link';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import {
  OpsAlert,
  OpsGrid,
  OpsPanel,
  OpsReadingStat,
  OpsReadout,
  OpsSection,
  OpsStack,
  OpsStatGroup,
  OpsStatStrip,
  opsButtonClass,
} from '@/components/ops/ui';
import { buildAdminConsoleModel } from '@/lib/ops/adminConsoleModel';
import { readAdminConsoleFacts } from '@/lib/ops/adminConsoleData';
import {
  ROLLOUT_STAGE_LABEL,
  ROLLOUT_STAGE_ORDER,
  permitsCommands,
} from '@/lib/ops/rolloutPosture';
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
                // `OpsReadingStat`, not `OpsStat`: every one of these comes
                // from a source that can be down, and this primitive is what
                // keeps an unread tile from carrying a unit or a tone that
                // would make its `n/a` read as a measurement.
                <OpsReadingStat
                  key={tile.label}
                  label={tile.label}
                  reading={tile.reading}
                  unit={tile.unit}
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
          <OpsAlert tone="warning" title="Some of this screen could not be read">
            {model.unreadable.join(', ')} did not answer, so those readings show{' '}
            <span className="font-mono">n/a</span> rather than a number. Nothing above is a measured
            zero.
          </OpsAlert>
        )}

        <OpsSection
          title="Needs you"
          description="Things only an administrator can put right. An empty list is the correct state, not a missing one."
        >
          {model.attention.length === 0 ? (
            <OpsAlert tone="success">
              Nothing is waiting on you: everybody active has what their role needs, no invite has
              run out of time, and command permissions are set.
            </OpsAlert>
          ) : (
            <OpsStack gap="tight">
              {model.attention.map((item) => (
                <OpsAlert
                  key={item.id}
                  tone={
                    item.tone === 'error' ? 'error' : item.tone === 'warning' ? 'warning' : 'info'
                  }
                  title={item.title}
                >
                  <p>{item.detail}</p>
                  {item.href && (
                    <Link
                      href={item.href}
                      className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Open the screen that fixes it
                    </Link>
                  )}
                </OpsAlert>
              ))}
            </OpsStack>
          )}
        </OpsSection>

        <OpsSection title="Can everybody actually sign in?">
          <OpsAdminRoleDriftPanel />
        </OpsSection>

        <OpsGrid columns={2}>
          <OpsPanel
            title="What each corridor is allowed to do"
            description="This is a safety setting, not a label. A corridor set to watch only, or to watch and suggest, refuses every instruction outright."
            actions={
              <Link href="/ops/admin/rollout-stages" className={opsButtonClass('quiet')}>
                Change permissions
              </Link>
            }
          >
            {!facts.rollout.ok ? (
              <OpsAlert tone="warning">
                The control service did not answer, so what each corridor is currently allowed to do
                is unknown here. Nothing has changed — this screen simply cannot read it.
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
                <p className="text-xs leading-relaxed text-subtle">
                  Corridors counted in the accent colour allow instructions. A corridor set to watch
                  only, or to watch and suggest, refuses them and records each attempt as blocked by
                  a safety rule — so a corridor sitting there is not merely unwatched, it is closed.
                </p>
              </OpsStack>
            )}
          </OpsPanel>

          <OpsPanel
            title="What the network can report"
            description="Corridors that have been surveyed, and the smaller number of those with a planned gap set."
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
                  label="Surveyed"
                  value={facts.network.ok ? facts.network.mapped : 'n/a'}
                />
                <OpsReadout
                  label="Can report buses closing up"
                  value={
                    facts.network.ok && facts.network.detecting !== null
                      ? facts.network.detecting
                      : 'n/a'
                  }
                  tone="accent"
                />
              </div>
              {model.coverageNotice ? (
                <p className="text-xs leading-relaxed text-subtle">{model.coverageNotice}</p>
              ) : (
                <p className="text-xs leading-relaxed text-subtle">
                  The control service did not answer, so coverage could not be counted at all.
                </p>
              )}
            </OpsStack>
          </OpsPanel>
        </OpsGrid>

        <OpsPanel
          title="Two things only an administrator can set"
          description="Both refuse rather than guess. Read this before treating either as a broken form."
        >
          <OpsStack gap="tight">
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Depot.</span> Somebody with a depot role
              sees only their own depot&apos;s buses, and that narrowing happens on the server
              before any bus data is sent. Someone with no depot set is refused outright rather than
              shown the whole state&apos;s buses, because the fallback that looks helpful is the one
              that hands 143 depots&apos; buses to whoever was set up last.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Bus.</span> The bus set on a driver
              decides which instructions reach them. If a driver could set their own, they could
              send another bus&apos;s instructions to their own cab — so only an administrator can
              set it, and a bus number sent by the driver is never trusted instead.
            </p>
            <Link href="/ops/admin/invites" className={opsButtonClass('default', 'self-start')}>
              Manage people and what they are set to
            </Link>
          </OpsStack>
        </OpsPanel>
      </OpsStack>
    </OpsShell>
  );
}
