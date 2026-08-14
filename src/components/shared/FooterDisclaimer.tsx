'use client';

import { useState } from 'react';
import { Info, ChevronUp, ChevronDown } from 'lucide-react';
import { FOOTER_DISCLAIMER } from '@/lib/constants';

/**
 * The permanent, always-accessible prototype disclosure at the foot of the
 * command centre. Collapsible for screen real estate, but the summary line
 * never disappears.
 *
 * ─── THE `light` VARIANT IS GONE ─────────────────────────────────────────
 *
 * Same story as MapFallback: it existed for the old light bunching
 * simulator, which moved onto the ops shell and stopped calling this. The
 * theme now does the job the prop was doing, and thirteen `light ? … : …`
 * ternaries left the file.
 *
 * ─── WHAT DID NOT CHANGE, AND MUST NOT ───────────────────────────────────
 *
 * Every word. This is the strip that separates what is MEASURED from what is
 * MODELLED on a surface where both are drawn on the same map, in the same
 * geometry, at the same moment. The provenance list below is the honest core
 * of this page and is reproduced verbatim; the closing sentence — that no
 * driver is contacted and nothing is executed automatically — is the single
 * most important sentence on the command centre. Restyling is allowed to
 * change how loudly it is said. It is not allowed to change what is said.
 */
export function FooterDisclaimer() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="relative z-30 shrink-0 border-t border-primary/15 bg-card"
      data-testid="footer-disclaimer"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors hover:bg-accent"
      >
        <Info className="h-3 w-3 shrink-0 text-warning" aria-hidden />
        <span className="badge-sim shrink-0">Prototype</span>
        <span className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-muted-foreground">
          {FOOTER_DISCLAIMER}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
        ) : (
          <ChevronUp className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-2.5">
          <p className="mb-2 text-[11px] leading-relaxed text-foreground">{FOOTER_DISCLAIMER}</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
            <li className="text-[10px] text-success">
              ● LIVE — UPSRTC GPS vehicle positions, speed, heading, depot and route identifiers
            </li>
            <li className="text-[10px] text-success">
              ● LIVE — UPSRTC schedule, stop sequence and scheduled times for the selected vehicle
            </li>
            <li className="text-[10px] text-primary">
              ● PREDICTIVE — bunching, traffic, breakdown, demand, redistribution and impact figures
            </li>
            <li className="text-[10px] text-primary">
              ● PREDICTIVE — confidence scores, recommendations, driver messages and call workflow
            </li>
          </ul>
          <p className="mt-2 border-t border-border pt-2 text-[10px] text-subtle">
            No driver is contacted. No operational instruction is executed automatically. Production
            deployment requires formal UPSRTC authorization and backend integration.
          </p>
        </div>
      )}
    </div>
  );
}
