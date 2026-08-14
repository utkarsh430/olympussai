/**
 * Whether a reported position is one this product is willing to draw.
 *
 * ─── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────
 *
 * The statewide control room opened on empty ocean. One vehicle in the live
 * feed - UP78JT5520, depot CHUTMALPUR - reported `latitude 0.000` with an
 * otherwise plausible longitude. The ops map fits its camera once over every
 * vehicle it is given, so that single reading stretched the fitted bounds from
 * the equator to lat 30.71 and centred the opening view at 15.35N: peninsular
 * India. Operators arrived at a map of Mumbai, Bengaluru, Chennai and Kerala
 * with the entire Uttar Pradesh fleet off the top edge, and had to pan north
 * on every first load. Nothing looked broken - every chevron was drawn
 * correctly, just outside the viewport.
 *
 * WHY THE EXISTING GATE DOES NOT CATCH IT. `isValidCoordinate` in
 * src/lib/upsrtc/normalizer.ts rejects null, non-finite, out-of-range and
 * exact (0,0). A zeroed latitude paired with a real longitude is none of
 * those: it is a valid point on the equator south of Ghana, and it is
 * explicitly allowed there (normalizer.test.ts asserts the mirror case
 * `isValidCoordinate(28.35, 0)` is true). A single zeroed axis is the gap.
 *
 * This module closes it for the DISPLAY surfaces, on the axis the feed-level
 * gate deliberately does not have an opinion about: not "is this a coordinate"
 * but "is this a coordinate on the network we serve".
 *
 * ─── WHY A BOUNDING BOX IS AN HONEST TEST ────────────────────────────────
 *
 * It is a claim about UPSRTC's geography rather than about a sentinel value,
 * so it also catches the next garbage reading, which will not be a zero. The
 * box below is deliberately far larger than the fleet: measured against the
 * production feed on 2026-08-14 (9,188 vehicles), the whole fleet sat inside
 * lat 23.84-30.71 and lng 74.64-84.26, including genuine interstate services
 * as far west as Ajmer and Jaipur in Rajasthan. UPSRTC runs into Delhi,
 * Uttarakhand, Haryana, Punjab, Himachal, Rajasthan, Madhya Pradesh, Bihar and
 * Jharkhand, so the box is drawn around that whole operating area with several
 * hundred kilometres of margin on every side.
 *
 * THE MARGIN IS THE POINT. A tight box would start hiding real buses the first
 * time a service was extended, which is a worse failure than the one being
 * fixed: an operator who cannot see a bus that is running has been lied to
 * just as surely as one shown a bus that is not. This box exists to reject
 * readings that are physically impossible for this network - a fix in the Gulf
 * of Guinea, off Australia, at the pole - not to police the timetable.
 *
 * Precedent for "this is not physically plausible for UPSRTC" as a check the
 * seeder already makes: control-service/src/seed/geometry.ts's
 * MAX_LEG_DISTANCE_METERS / MAX_STOP_DETOUR_METERS.
 *
 * No 'use client' and no 'server-only': the rule has to be applied on both
 * sides of the boundary and must be unit-testable without a browser.
 */
import type { MapPoint } from './contract';

/**
 * The area UPSRTC operates in, generously drawn.
 *
 * Not the fleet's observed extent and not Uttar Pradesh's border - both would
 * be too tight to survive a route extension. See the note above on why the
 * margin is deliberate.
 */
export const SERVED_NETWORK_BOUNDS = {
  /** Below the southernmost plausible interstate working (well south of Madhya Pradesh). */
  south: 20,
  /** Above the northernmost, covering the Himachal and Uttarakhand hill services. */
  north: 32,
  /** West of the Rajasthan services (Ajmer, the observed extreme, is 74.64). */
  west: 72,
  /** East of the Bihar and West Bengal workings. */
  east: 89,
} as const;

/**
 * True when a position can honestly be drawn as a vehicle on this network.
 *
 * The three rejections are listed separately even though the bounding box
 * subsumes the first two, because each names a distinct thing that goes wrong
 * upstream and the box is the one most likely to be widened later.
 */
export function isPlottablePosition(latitude: number, longitude: number): boolean {
  // NaN and the infinities. A NaN silently poisons every comparison it touches
  // - including the bounds test below, which would otherwise return false for
  // the right answer for the wrong reason.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  // Exact (0,0). Already outside the box, and kept as its own named rejection
  // because it is the GPS "no fix" sentinel rather than a wrong location, and
  // because it must stay rejected if the box is ever widened.
  if (latitude === 0 && longitude === 0) return false;

  return (
    latitude >= SERVED_NETWORK_BOUNDS.south &&
    latitude <= SERVED_NETWORK_BOUNDS.north &&
    longitude >= SERVED_NETWORK_BOUNDS.west &&
    longitude <= SERVED_NETWORK_BOUNDS.east
  );
}

export interface PlottablePartition<T> {
  /** Safe to draw and to fit the camera over. */
  plottable: T[];
  /**
   * Reported a position this network cannot contain.
   *
   * Returned rather than discarded so the surface can say how many vehicles it
   * removed. Dropping them silently would quietly shrink the operator's fleet;
   * drawing them would put a bus in the sea. Neither is acceptable on a
   * console whose premise is that what it shows is real.
   */
  unplottable: T[];
}

/** Split a set of positioned records into what may be drawn and what may not. */
export function partitionPlottable<T extends MapPoint>(records: readonly T[]): PlottablePartition<T> {
  const plottable: T[] = [];
  const unplottable: T[] = [];
  for (const record of records) {
    if (isPlottablePosition(record.latitude, record.longitude)) plottable.push(record);
    else unplottable.push(record);
  }
  return { plottable, unplottable };
}
