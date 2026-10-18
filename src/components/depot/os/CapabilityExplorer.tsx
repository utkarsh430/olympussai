'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { depotIdFromPath } from '@/lib/depot/depotNav';
import { CAPABILITIES } from '@/lib/depot/os/capabilities';
import { OPERATIONAL_WORKSPACES, viewByKey, viewLink, WORKSPACES } from '@/lib/depot/os/workspaces';
import { OsOverlay, OverlayClose } from './OsOverlay';
import { useOsStore } from './osStore';
import { StatusTag } from './ui';

/** The index of AI capabilities, grouped by the workspace each one runs in. */
export function CapabilityExplorer() {
  const open = useOsStore((s) => s.capabilitiesOpen);
  const setOpen = useOsStore((s) => s.setCapabilitiesOpen);
  const pathname = usePathname() ?? '';
  const depotId = depotIdFromPath(pathname);
  const close = (): void => setOpen(false);

  const groups = [...OPERATIONAL_WORKSPACES, ...WORKSPACES.filter((w) => w.id === 'system')]
    .map((workspace) => ({
      workspace,
      items: CAPABILITIES.filter((c) => viewByKey(c.view)?.workspace.id === workspace.id),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <OsOverlay open={open} onClose={close} label="AI capabilities" variant="drawer" widthClass="sm:w-[40rem]" testId="os-capabilities">
      <header className="os-panel-head">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-holo-glow" aria-hidden />
          <div>
            <div className="os-kicker">Depot Intelligence OS</div>
            <h2 className="os-heading">{CAPABILITIES.length} AI capabilities and where they run</h2>
          </div>
        </div>
        <OverlayClose onClose={close} />
      </header>
      <div className="os-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {groups.map(({ workspace, items }) => (
          <section key={workspace.id}>
            <h3 className="os-kicker mb-2 text-holo-glow">
              {workspace.ordinal ? `${workspace.ordinal} · ` : ''}
              {workspace.title}
            </h3>
            <ul className="divide-y divide-holo-glow/[0.07] rounded-md border border-holo-glow/10">
              {items.map((capability) => {
                const found = viewByKey(capability.view);
                const href = found ? viewLink(found.view, depotId) : '#';
                return (
                  <li key={capability.id}>
                    <Link href={href} onClick={close} className="flex items-start gap-3 px-3 py-2.5 hover:bg-depot-raised">
                      <span className="mt-0.5 w-6 shrink-0 font-mono text-[10.5px] text-depot-muted">
                        {String(CAPABILITIES.indexOf(capability) + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-[13px] font-semibold text-depot-ink">{capability.name}</span>
                        <span className="block font-sans text-[12px] leading-4 text-depot-prose">{capability.does}</span>
                        <span className="mt-1 block font-sans text-[11px] text-depot-muted">Runs in {found?.view.label ?? capability.view}</span>
                      </span>
                      <StatusTag status={capability.basis} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </OsOverlay>
  );
}
