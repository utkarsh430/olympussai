// Whether a reported position is one this network could physically contain.
//
// THIS IS THE SECOND COPY OF A RULE THAT MUST NOT DRIFT. The first is the web
// app's src/lib/maps/plottable.ts, which applies it to the ops map so a bad
// reading cannot stretch the fitted camera. This one applies it to arrival
// prediction, so a bad reading cannot become a countdown on a driver's screen.
// The two live in separate deployables with no shared package, so the box is
// duplicated deliberately rather than imported. If either is widened, widen
// both - and both carry this note.
//
// The defect it exists for: one vehicle in the live feed (UP78JT5520, depot
// CHUTMALPUR) reported `latitude 0.000` with an otherwise plausible longitude.
// That is a VALID coordinate - a point on the equator south of Ghana - so the
// feed-level gate in ingestion/upsrtc/normalize.ts, which rejects null,
// non-finite, out-of-range and exact (0,0), correctly lets it through. A single
// zeroed axis is the gap, and it is only detectable against a claim about where
// this operator actually runs.
//
// The margin is the point. A tight box would start hiding real buses the first
// time a service was extended, which is a worse failure than the one being
// fixed. This box rejects readings that are physically impossible for UPSRTC -
// a fix in the Gulf of Guinea, off Australia, at the pole - not ones that are
// merely unusual.

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

/** True when a position could honestly be a vehicle on the network this service controls. */
export function isPositionOnServedNetwork(latitude: number, longitude: number): boolean {
  // NaN and the infinities first: a NaN silently poisons every comparison it
  // touches, including the bounds test below, which would otherwise return the
  // right answer for the wrong reason.
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
