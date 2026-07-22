'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Send, Lock, Check, X, ShieldAlert } from 'lucide-react';
import { useCopilotStore, useSelectedBus } from '@/stores/copilotStore';
import { Badge, Waveform } from '@/components/shared/hud';
import { buildCommunicationScenario, COMMUNICATION_STATE_LABELS } from '@/lib/demo-scenarios/communicationScenario';
import { formatIndiaDateTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';

type SendPhase = 'draft' | 'encrypting' | 'delivered' | 'acknowledged';

/**
 * Driver messaging workflow.
 * No SMS/push provider is integrated. No driver receives anything.
 */
export function DriverMessageModal() {
  const isOpen = useCopilotStore((state) => state.isMessageModalOpen);
  const setOpen = useCopilotStore((state) => state.setMessageModalOpen);
  const scenario = useCopilotStore((state) => state.activeScenario);
  const overrides = useCopilotStore((state) => state.overrides);
  const setCommunicationState = useCopilotStore((state) => state.setCommunicationState);
  const communicationState = useCopilotStore((state) => state.communicationState);
  const setAi = useCopilotStore((state) => state.setAi);
  const logAudit = useCopilotStore((state) => state.logAudit);
  const bus = useSelectedBus();

  const [phase, setPhase] = useState<SendPhase>('draft');
  const [english, setEnglish] = useState('');
  const [hindi, setHindi] = useState('');

  const draft =
    bus &&
    buildCommunicationScenario(
      { bus, schedule: null, overrides },
      {
        scenarioKind: scenario?.kind ?? 'communication',
        scenarioLabel: scenario?.simulationLabel ?? 'DRIVER COMMUNICATION',
        suggestedAction: scenario?.recommendation ?? 'Await further instructions from the control room.',
        englishMessage:
          scenario?.suggestedDriverMessageEn ??
          'Traffic congestion is expected ahead. Maintain the approved safe speed and await further instructions from the control room.',
        hindiMessage:
          scenario?.suggestedDriverMessageHi ??
          'आगे यातायात की भीड़ की संभावना है। स्वीकृत सुरक्षित गति बनाए रखें और नियंत्रण कक्ष के अगले निर्देश की प्रतीक्षा करें।',
      },
    );

  // Reset the draft each time the modal opens.
  useEffect(() => {
    if (isOpen && draft) {
      setPhase('draft');
      setEnglish(draft.message.englishMessage);
      setHindi(draft.message.hindiMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bus?.registrationNumber]);

  // Escape closes.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, setOpen]);

  function handleSend() {
    if (!bus || !draft) return;

    setPhase('encrypting');
    setCommunicationState('message-sent');
    setAi('Monitoring', 'Instruction transmitted. Awaiting driver acknowledgement.');
    logAudit('message-sent', `Instruction transmitted to ${bus.registrationNumber}`, {
      registrationNumber: bus.registrationNumber,
      detail: english,
    });

    const deliveryTimer = setTimeout(() => setPhase('delivered'), 1500);
    const ackDelay = (draft.call.acknowledgementDelaySeconds ?? 4) * 1000;

    const ackTimer = setTimeout(() => {
      setPhase('acknowledged');
      setCommunicationState('driver-acknowledged');
      logAudit('acknowledgement-received', `Driver acknowledgement from ${bus.registrationNumber}`, {
        registrationNumber: bus.registrationNumber,
      });
    }, 1500 + ackDelay);

    return () => {
      clearTimeout(deliveryTimer);
      clearTimeout(ackTimer);
    };
  }

  if (!bus || !draft) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-void/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Driver message"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <motion.div
            initial={{ scale: 0.94, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 20 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            className="hud-panel-strong hud-corners w-[620px] max-w-[92vw] overflow-hidden"
            data-testid="driver-message-modal"
          >
            {/* Prominent demo banner */}
            <div className="flex items-center justify-center gap-2 border-b border-alert-amber/35 bg-alert-amber/12 py-2">
              <ShieldAlert className="h-3.5 w-3.5 text-alert-amber" aria-hidden />
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-alert-amber">
                {draft.message.demoBanner}
              </span>
            </div>

            <header className="flex items-center justify-between border-b border-holo-glow/15 px-4 py-2.5">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">
                Driver Communication — Dispatcher Review
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="hud-button px-2 py-1"
                aria-label="Close message dialog"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </header>

            <div className="max-h-[65vh] overflow-y-auto p-4">
              {/* Workflow state */}
              {communicationState && (
                <div className="mb-3 flex items-center gap-2">
                  <span className="hud-label">Workflow state</span>
                  <Badge variant="sim">{COMMUNICATION_STATE_LABELS[communicationState]}</Badge>
                </div>
              )}

              <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Field label="Bus registration" value={draft.message.registrationNumber} live />
                <Field label="Scenario" value={draft.message.scenarioLabel} />
                <Field label="Location" value={draft.message.location} live />
                <Field
                  label="Instruction expires"
                  value={formatIndiaDateTime(draft.message.expiresAt)}
                />
              </div>

              <div className="mb-3 rounded border border-holo-teal/25 bg-holo-teal/[0.06] px-3 py-2">
                <span className="hud-label text-holo-teal/70">Suggested action</span>
                <p className="font-mono text-[11px] leading-relaxed text-holo-teal">
                  {draft.message.suggestedAction}
                </p>
              </div>

              <MessageField
                label="English message"
                value={english}
                onChange={setEnglish}
                disabled={phase !== 'draft'}
              />

              <MessageField
                label="Hindi message · हिन्दी संदेश"
                value={hindi}
                onChange={setHindi}
                disabled={phase !== 'draft'}
              />

              <p className="mt-3 flex items-start gap-2 rounded border border-alert-amber/25 bg-alert-amber/[0.06] px-3 py-2 font-mono text-[10px] leading-relaxed text-alert-amber/85">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {draft.message.approvalWarning}
              </p>

              {/* Transmission theatre */}
              <AnimatePresence>
                {phase !== 'draft' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 overflow-hidden rounded border border-holo-glow/20 bg-void-900/60 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="hud-label">Transmission status</span>
                      <span
                        className={cn(
                          'font-mono text-[10px] uppercase tracking-wider',
                          phase === 'acknowledged' ? 'text-alert-green' : 'text-holo-glow',
                        )}
                        data-testid="message-status"
                      >
                        {phase === 'encrypting'
                          ? 'Encrypting channel…'
                          : phase === 'delivered'
                            ? 'Delivered — awaiting acknowledgement'
                            : 'Driver acknowledged'}
                      </span>
                    </div>

                    <Waveform bars={34} active={phase !== 'acknowledged'} className="mb-2 h-6" />

                    <ol className="space-y-1">
                      <Step done label="Message prepared by dispatcher" />
                      <Step done label="Channel encrypted" />
                      <Step
                        done={phase === 'delivered' || phase === 'acknowledged'}
                        label="Delivered to driver terminal"
                      />
                      <Step
                        done={phase === 'acknowledged'}
                        label="Driver acknowledgement received"
                      />
                    </ol>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-holo-glow/15 px-4 py-3">
              <span className="font-mono text-[9px] uppercase tracking-wider text-holo-glow/45">
                Dispatcher approval required before transmission
              </span>

              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="hud-button">
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={phase !== 'draft'}
                  className="hud-button-primary"
                  data-testid="send-driver-message"
                >
                  {phase === 'draft' ? (
                    <>
                      <Send className="h-3.5 w-3.5" aria-hidden />
                      Approve &amp; Send
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Transmitted
                    </>
                  )}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="hud-label flex items-center gap-1.5">
        {label}
        {live && <span className="text-[8px] text-alert-green">● LIVE</span>}
      </div>
      <div className="truncate font-mono text-[11px] text-holo-glow">{value}</div>
    </div>
  );
}

function MessageField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="mb-3 block">
      <span className="hud-label mb-1 block">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={3}
        className="hud-input resize-none leading-relaxed disabled:opacity-60"
        aria-label={label}
      />
    </label>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
          done ? 'border-alert-green bg-alert-green/20' : 'border-holo-glow/25',
        )}
        aria-hidden
      >
        {done && <Check className="h-2 w-2 text-alert-green" />}
      </span>
      <span
        className={cn('font-mono text-[10px]', done ? 'text-holo-glow/80' : 'text-holo-glow/35')}
      >
        {label}
      </span>
    </li>
  );
}
