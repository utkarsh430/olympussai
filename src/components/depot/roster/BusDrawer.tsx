'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import { BUS_LOCATION_LABEL, BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { RosterRow } from '@/lib/depot/roster/rosterModel';
import type { Provenance } from '@/lib/depot/types';
import { BusTimetable } from './BusTimetable';

export interface BusDrawerProps {
  readonly registration: string;
  /** The open bus's row, or null when a poll no longer contains it. */
  readonly row: RosterRow | null;
  readonly feedNow: string | null;
  readonly onClose: () => void;
  /** Where focus goes when the sheet closes: the opener, else a page fallback. */
  readonly restoreFocusTo: () => HTMLElement | null;
}

const DASH = '—';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Fact {
  readonly label: string;
  readonly value: string;
  readonly provenance: Provenance;
}

function factsOf(row: RosterRow): readonly Fact[] {
  const { bus } = row;
  const away = bus.location === 'away' && bus.distanceFromYardKm !== null;
  return [
    { label: 'State', value: BUS_STATE_LABEL[bus.state], provenance: 'derived' },
    {
      label: 'Location',
      value: away
        ? `${BUS_LOCATION_LABEL[bus.location]}, ${formatCount(Math.round(bus.distanceFromYardKm ?? 0))} km from yard`
        : BUS_LOCATION_LABEL[bus.location],
      provenance: 'derived',
    },
    { label: 'Route', value: bus.routeName ?? DASH, provenance: 'live' },
    { label: 'Scheduled start', value: bus.scheduledStart ?? DASH, provenance: 'live' },
    { label: 'Scheduled end', value: bus.scheduledEnd ?? DASH, provenance: 'live' },
    ...(row.delay ? [{ label: 'Running', value: row.delay, provenance: 'derived' as const }] : []),
    { label: 'Trip status', value: bus.tripStatus ?? DASH, provenance: 'live' },
    {
      label: 'Speed',
      value: bus.speedKmph === null ? DASH : `${formatCount(Math.round(bus.speedKmph))} km/h`,
      provenance: 'live',
    },
    { label: 'Last heard', value: row.lastHeard, provenance: 'live' },
    {
      label: 'Device flags',
      value: row.flags.length === 0 ? 'None raised' : row.flags.join('; '),
      provenance: 'live',
    },
  ];
}

/**
 * Side sheet for one bus. A modal dialog: focus moves in, Tab is held inside,
 * Escape and the close button leave, and focus is handed back by the caller's
 * `onClose` (the page restores it to the button that opened the sheet).
 */
export function BusDrawer({
  registration,
  row,
  feedNow,
  onClose,
  restoreFocusTo,
}: BusDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const restoreRef = useRef(restoreFocusTo);
  useEffect(() => {
    closeRef.current = onClose;
    restoreRef.current = restoreFocusTo;
  });

  // The page behind does not scroll while the sheet is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const panel = panelRef.current;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !panel.contains(active);
      if (event.shiftKey) {
        if (outside || active === first || active === titleRef.current) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // On close, hand focus back to the opener, or to the page's fallback.
  useEffect(
    () => () => {
      const target = restoreRef.current();
      if (target?.isConnected) target.focus();
    },
    [],
  );

  const bus = row?.bus ?? null;
  const dialog = (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="bus-drawer">
      <div className="absolute inset-0 bg-depot-page/70" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bus-drawer-title"
        className="relative flex h-full w-full min-w-0 flex-col overflow-y-auto border-l border-depot-line bg-depot-surface p-4 sm:max-w-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id="bus-drawer-title"
            ref={titleRef}
            tabIndex={-1}
            className="min-w-0 break-words font-mono text-base text-depot-ink outline-none"
          >
            Bus {registration}
          </h2>
          <button type="button" className="hud-button shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        {bus === null || row === null ? (
          <p className="depot-prose" role="status">
            This bus is no longer in this depot&apos;s feed. It may have been reassigned or
            dropped from the latest snapshot.
          </p>
        ) : (
          <>
            <dl className="m-0 mb-5 grid grid-cols-1 gap-y-2">
              {factsOf(row).map((fact) => (
                <div key={fact.label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3">
                  <dt className="depot-label self-center">{fact.label}</dt>
                  <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 font-mono text-[13px] text-depot-ink">
                    <span className="min-w-0 break-words">{fact.value}</span>
                    <ProvenanceBadge provenance={fact.provenance} />
                  </dd>
                </div>
              ))}
            </dl>
            <h3 className="depot-label mb-2">Timetable</h3>
            <BusTimetable
              registration={bus.registrationNumber}
              hasRoute={bus.routeName !== null && bus.routeName !== ''}
              tripDate={bus.tripDate}
              journeyId={bus.journeyId}
              position={
                bus.latitude !== null && bus.longitude !== null
                  ? { latitude: bus.latitude, longitude: bus.longitude }
                  : null
              }
              gpsAgeMin={bus.gpsAgeMin}
              state={bus.state}
              feedNow={feedNow}
            />
          </>
        )}
      </div>
    </div>
  );
  return createPortal(dialog, document.body);
}
