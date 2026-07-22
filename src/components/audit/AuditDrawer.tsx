'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { X, Download, Trash2, FileText, ScrollText } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { Badge } from '@/components/shared/hud';
import {
  AUDIT_EVENT_LABELS,
  exportAuditJson,
  exportAuditSummary,
  downloadTextFile,
} from '@/lib/audit/auditLog';
import { formatIndiaDateTime } from '@/lib/formatters';

/** Local demonstration audit trail (localStorage). */
export function AuditDrawer() {
  const isOpen = useCopilotStore((state) => state.isAuditOpen);
  const toggle = useCopilotStore((state) => state.toggleAudit);
  const events = useCopilotStore((state) => state.auditEvents);
  const clearAudit = useCopilotStore((state) => state.clearAudit);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggle(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, toggle]);

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: -440, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -440, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="hud-panel-strong hud-corners fixed left-0 top-0 z-[95] flex h-full w-[420px] flex-col overflow-hidden"
          role="dialog"
          aria-label="Session audit trail"
          data-testid="audit-drawer"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-holo-glow/20 px-4 py-3">
            <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
              <ScrollText className="h-3.5 w-3.5" aria-hidden />
              Audit Timeline
            </h2>
            <button
              type="button"
              onClick={() => toggle(false)}
              className="hud-button px-2 py-1"
              aria-label="Close audit timeline"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="shrink-0 border-b border-holo-glow/12 px-4 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="hud-label">Recorded events</span>
              <span className="font-mono text-xs tabular-nums text-holo-teal">{events.length}</span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                className="hud-button px-1.5 text-[9px]"
                onClick={() =>
                  downloadTextFile(
                    `upsrtc-copilot-audit-${timestamp}.json`,
                    exportAuditJson(events),
                    'application/json',
                  )
                }
              >
                <Download className="h-3 w-3" aria-hidden />
                JSON
              </button>
              <button
                type="button"
                className="hud-button px-1.5 text-[9px]"
                onClick={() =>
                  downloadTextFile(
                    `upsrtc-copilot-summary-${timestamp}.txt`,
                    exportAuditSummary(events),
                    'text/plain',
                  )
                }
              >
                <FileText className="h-3 w-3" aria-hidden />
                Summary
              </button>
              <button
                type="button"
                className="hud-button-danger px-1.5 text-[9px]"
                onClick={clearAudit}
                data-testid="clear-audit"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                Clear
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {events.length === 0 && (
              <p className="px-4 py-8 text-center font-mono text-[11px] text-holo-glow/40">
                No events recorded yet. Select a vehicle or open an alert to begin the audit trail.
              </p>
            )}

            <ol className="relative">
              {events.map((event, index) => (
                <motion.li
                  key={event.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.02, 0.3) }}
                  className="border-b border-holo-glow/[0.07] px-4 py-2.5"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-holo-teal">
                      {AUDIT_EVENT_LABELS[event.type]}
                    </span>
                    <Badge variant={event.simulated ? 'sim' : 'live'}>
                      {event.simulated ? 'MODEL' : 'LIVE'}
                    </Badge>
                  </div>

                  <p className="font-mono text-[10px] leading-relaxed text-holo-glow/70">
                    {event.summary}
                  </p>

                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono text-[9px] text-holo-glow/30">
                      {formatIndiaDateTime(event.at)}
                    </span>
                    {event.registrationNumber && (
                      <span className="font-mono text-[9px] text-holo-glow/40">
                        {event.registrationNumber}
                      </span>
                    )}
                  </div>
                </motion.li>
              ))}
            </ol>
          </div>

          <footer className="shrink-0 border-t border-holo-glow/15 px-4 py-2">
            <p className="font-mono text-[9px] leading-relaxed text-holo-glow/40">
              Stored locally in this browser only. Raw upstream GPS payloads are never persisted.
            </p>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
