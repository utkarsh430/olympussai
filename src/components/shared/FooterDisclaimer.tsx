'use client';

import { useState } from 'react';
import { Info, ChevronUp, ChevronDown } from 'lucide-react';
import { FOOTER_DISCLAIMER } from '@/lib/constants';

/**
 * Permanent, always-accessible prototype disclaimer.
 * Collapsible for screen real estate, but the summary line never disappears.
 */
export function FooterDisclaimer() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="relative z-30 shrink-0 border-t border-holo-glow/15 bg-[rgb(5,11,23)]"
      data-testid="footer-disclaimer"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors hover:bg-holo-glow/[0.04]"
      >
        <Info className="h-3 w-3 shrink-0 text-alert-amber" aria-hidden />
        <span className="shrink-0 rounded border border-holo-teal/45 bg-holo-teal/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-holo-teal">
          Prototype
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] leading-relaxed text-holo-glow/50">
          {FOOTER_DISCLAIMER}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-holo-glow/40" aria-hidden />
        ) : (
          <ChevronUp className="h-3 w-3 shrink-0 text-holo-glow/40" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="border-t border-holo-glow/10 px-4 py-2.5">
          <p className="mb-2 font-mono text-[10px] leading-relaxed text-holo-glow/65">
            {FOOTER_DISCLAIMER}
          </p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
            <li className="font-mono text-[9px] text-alert-green/70">
              ● LIVE — UPSRTC GPS vehicle positions, speed, heading, depot and route identifiers
            </li>
            <li className="font-mono text-[9px] text-alert-green/70">
              ● LIVE — UPSRTC schedule, stop sequence and scheduled times for the selected vehicle
            </li>
            <li className="font-mono text-[9px] text-holo-teal/70">
              ● PREDICTIVE — bunching, traffic, breakdown, demand, redistribution and impact figures
            </li>
            <li className="font-mono text-[9px] text-holo-teal/70">
              ● PREDICTIVE — confidence scores, recommendations, driver messages and call workflow
            </li>
          </ul>
          <p className="mt-2 border-t border-holo-glow/10 pt-2 font-mono text-[9px] text-holo-glow/45">
            No driver is contacted. No operational instruction is executed automatically. Production
            deployment requires formal UPSRTC authorization and backend integration.
          </p>
        </div>
      )}
    </div>
  );
}
