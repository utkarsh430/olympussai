/*
 * The yard lists per width (critique round 5, section 7 and section 8). On a phone the
 * standing and off-road groups drop REASON (when every listed row gives the same reason it
 * becomes the group's note), and the away list keeps REGISTRATION · STATE · FROM YARD. The
 * away list's "In the yard of" column shows only when a row actually shown has a value.
 */
import { contentWidthAt } from '../shell/geometry';

export type YardTier = 'phone' | 'wide';

export type YardColumnKey = 'registration' | 'state' | 'km' | 'notHeard' | 'reason' | 'atYard';

/** Each column's width per tier, in px. */
export const YARD_COLUMN_PX: Readonly<Record<YardTier, Readonly<Record<YardColumnKey, number>>>> = {
  wide: { registration: 160, state: 128, km: 112, notHeard: 128, reason: 240, atYard: 200 },
  phone: { registration: 128, state: 104, km: 96, notHeard: 104, reason: 0, atYard: 0 },
};

/** The yard table's width cap above a phone, in px. */
export const YARD_TABLE_CAP_PX = 760;

/**
 * The frame each tier must fit: above a phone the cap or the 800 px content column,
 * whichever is narrower; on a phone the content column of a 390 px screen.
 */
export const YARD_FRAME_PX: Readonly<Record<YardTier, number>> = {
  wide: Math.min(YARD_TABLE_CAP_PX, contentWidthAt(800)),
  phone: contentWidthAt(390),
};

/** The spare every set leaves. */
export const YARD_MIN_SPARE_PX = 8;

export function rollColumnKeys(tier: YardTier, showReason: boolean): readonly YardColumnKey[] {
  return showReason && tier === 'wide'
    ? ['registration', 'notHeard', 'reason']
    : ['registration', 'notHeard'];
}

export function unknownColumnKeys(): readonly YardColumnKey[] {
  return ['registration', 'state', 'notHeard'];
}

export function awayColumnKeys(tier: YardTier, showAtYard: boolean): readonly YardColumnKey[] {
  if (tier === 'phone') return ['registration', 'state', 'km'];
  const base: readonly YardColumnKey[] = ['registration', 'state', 'km', 'notHeard'];
  return showAtYard ? [...base, 'atYard'] : base;
}

/** Shown only when a row on screen stands in another depot's yard (not one hidden by a cap). */
export function showAtYardFor(visible: readonly { readonly atYard: string }[]): boolean {
  return visible.some((row) => row.atYard !== '');
}

/** The one reason every listed row gives, for the group's note on a phone; else null. */
export function sharedReason(rows: readonly { readonly reason: string }[]): string | null {
  const first = rows[0]?.reason ?? '';
  if (first === '') return null;
  return rows.every((row) => row.reason === first) ? first : null;
}
