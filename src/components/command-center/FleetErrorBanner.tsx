'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert, Database } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';

/** Non-blocking banner for degraded upstream states. Never shows a raw stack. */
export function FleetErrorBanner() {
  const meta = useCopilotStore((state) => state.feedMeta);
  const isLoading = useCopilotStore((state) => state.isLoadingFleet);
  const buses = useCopilotStore((state) => state.buses);

  const showUnavailable = meta.source === 'unavailable';
  const showFixture = meta.source === 'fixture';
  const showStale = meta.stale && meta.source === 'cache';
  const showError = Boolean(meta.error);
  const showEmpty = !isLoading && buses.length === 0 && !meta.error;

  const visible = showUnavailable || showFixture || showStale || showError || showEmpty;

  // The unavailable state is checked first and worded as an outage: nothing is
  // being shown, and that emptiness must not read as "a quiet night".
  const message = showUnavailable
    ? 'UPSRTC live endpoint unavailable — the upstream did not answer and no cached positions are held. No vehicles are shown; this is an outage, not an empty road.'
    : showError
      ? `Live UPSRTC feed degraded — ${meta.error}. Showing the last known good data.`
      : showFixture
        ? 'UPSRTC live endpoint unavailable. Operating on bundled fixture data (explicitly enabled) — these vehicles are not real.'
        : showStale
          ? 'Live UPSRTC feed did not refresh on the last cycle. Showing the last known good positions.'
          : 'The UPSRTC live endpoint returned no usable vehicle records on the last cycle.';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="relative z-30 shrink-0 overflow-hidden border-b border-alert-amber/30 bg-alert-amber/[0.08]"
          role="status"
        >
          <div className="flex items-center gap-2.5 px-4 py-1.5">
            {showFixture ? (
              <Database className="h-3.5 w-3.5 shrink-0 text-alert-amber" aria-hidden />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 animate-flicker text-alert-amber" aria-hidden />
            )}
            <span className="font-mono text-[10px] leading-relaxed text-alert-amber/90">
              {message}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
