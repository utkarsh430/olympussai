'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bot, Command, Menu, Search } from 'lucide-react';
import { OlympussMark } from '@/components/shared/OlympussMark';
import { DepotSignOut } from '@/components/depot/shell/DepotSignOut';
import { FeedStatus } from '@/components/depot/shell/FeedStatus';
import { MODULE_DATA_LABEL, MODULE_DATA_TITLE } from '@/lib/depot/os/dataStatus';
import { DATA_HEALTH_PATH } from '@/lib/depot/os/workspaces';
import { ContextSelector } from './ContextSelector';
import { useIntel } from './IntelProvider';
import { useOsStore } from './osStore';

/**
 * The OS bar: brand, the context selector, the command palette, the AI engine's state,
 * the module's data status, the feed chip, the copilot, Operations and Sign out. One row
 * at every width; below 1280px Operations and Sign out sit behind Menu.
 */
export function OsTopBar() {
  const setPaletteOpen = useOsStore((s) => s.setPaletteOpen);
  const copilotOpen = useOsStore((s) => s.copilotOpen);
  const setCopilotOpen = useOsStore((s) => s.setCopilotOpen);
  const intel = useIntel();
  const critical = intel.decisions.filter((d) => d.severity === 'critical').length;

  return (
    <header
      data-testid="depot-top-bar"
      className="relative z-40 flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-depot-line bg-depot-bar px-3 sm:sticky sm:top-0 sm:h-[var(--depot-bar-h)] sm:gap-3 sm:px-4"
    >
      <div data-testid="depot-top-bar-scope" className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <Link
          href="/project/depots"
          data-testid="depot-brand"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap"
          aria-label="Olympuss AI Depot Intelligence OS, Mission Control"
        >
          <OlympussMark className="h-7 w-7" rays={false} />
          <span className="hidden flex-col leading-none lg:flex">
            <span className="depot-brand font-display text-[11px] uppercase tracking-[0.2em]">Olympuss AI</span>
            <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-depot-muted">
              Depot Intelligence OS
            </span>
          </span>
        </Link>
        <span className="hidden h-6 w-px bg-depot-line lg:block" aria-hidden />
        <ContextSelector />
      </div>

      <div data-testid="depot-top-bar-actions" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          data-testid="os-palette-open"
          className="hidden h-8 items-center gap-2 rounded-[4px] border border-depot-line bg-depot-surface px-2.5 font-sans text-[12px] text-depot-prose hover:border-holo-glow/40 hover:text-depot-ink md:inline-flex"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden min-[1700px]:inline">Search vehicles, depots, views</span>
          <span className="min-[1700px]:hidden">Search</span>
          <span className="inline-flex items-center gap-0.5 rounded-[3px] border border-depot-line px-1 font-mono text-[10px] text-depot-muted">
            <Command className="h-2.5 w-2.5" aria-hidden />K
          </span>
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search"
          className="depot-bar-button md:hidden"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
        </button>

        <span
          className="hidden items-center gap-1.5 rounded-[3px] border border-holo-glow/30 bg-holo-glow/[0.06] px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-holo-glow min-[1700px]:inline-flex"
          title={
            intel.ready
              ? `The AI engine ranked ${intel.decisions.length} decisions on the latest snapshot; ${critical} critical.`
              : 'The AI engine is reading the latest snapshot.'
          }
          data-testid="os-ai-status"
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full bg-holo-glow ${intel.ready ? 'os-pulse' : ''}`} aria-hidden />
          {intel.ready ? `AI · ${intel.decisions.length} decisions` : 'AI · reading'}
          {critical > 0 ? <span className="text-alert-crimson">· {critical} critical</span> : null}
        </span>

        <Link
          href={DATA_HEALTH_PATH}
          title={MODULE_DATA_TITLE}
          data-testid="os-data-status"
          className="hidden rounded-[3px] border border-slate-400/35 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300 hover:border-slate-300/60 xl:inline-flex"
        >
          {MODULE_DATA_LABEL}
        </Link>

        <FeedStatus />

        <button
          type="button"
          onClick={() => setCopilotOpen(!copilotOpen)}
          aria-pressed={copilotOpen}
          data-testid="os-copilot-toggle"
          className={`depot-bar-button ${copilotOpen ? 'border-holo-glow/70 bg-holo-glow/15' : ''}`}
        >
          <Bot className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Copilot</span>
        </button>

        <Link
          href="/project/upsrtc"
          data-testid="depot-back-to-operations"
          className="depot-bar-button depot-bar-button-quiet hidden xl:inline-flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Operations
        </Link>
        <span className="hidden xl:contents">
          <DepotSignOut quiet />
        </span>
        <OsBarMenu />
      </div>
    </header>
  );
}

/** Below 1280px: Operations and Sign out behind one button. */
function OsBarMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname() ?? '';
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div
      className="xl:hidden"
      data-testid="depot-bar-menu"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Menu"
        onClick={() => setOpen((value) => !value)}
        className="depot-bar-button"
      >
        <Menu className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          id={panelId}
          data-testid="depot-bar-menu-panel"
          className="absolute inset-x-0 top-full z-50 flex flex-wrap items-center gap-2 border-b border-depot-line bg-depot-page px-4 py-3 sm:px-6"
        >
          <Link href={DATA_HEALTH_PATH} className="depot-bar-button">
            {MODULE_DATA_LABEL}
          </Link>
          <Link href="/project/upsrtc" className="depot-bar-button">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Operations
          </Link>
          <DepotSignOut />
        </div>
      ) : null}
    </div>
  );
}
