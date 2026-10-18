import { haversineKm } from '@/lib/simulation/seededRandom';
import type { DepotSummary, LatLng } from '../types';

/**
 * The corporation's regions, each with the city its regional office sits in (REFERENCE).
 * A depot is placed in a region by name first (a depot named after a region's city
 * belongs to it), then by the nearest regional office to the depot's fleet centre. The
 * feed carries no region field, so the placement is an assignment rule, stated on the
 * Integration Health page, not a record from the corporation.
 */
export interface Region {
  readonly id: string;
  readonly name: string;
  readonly office: LatLng;
}

export const REGIONS: readonly Region[] = [
  { id: 'agra', name: 'Agra', office: { lat: 27.1767, lng: 78.0081 } },
  { id: 'aligarh', name: 'Aligarh', office: { lat: 27.8974, lng: 78.088 } },
  { id: 'ayodhya', name: 'Ayodhya', office: { lat: 26.7922, lng: 82.1998 } },
  { id: 'azamgarh', name: 'Azamgarh', office: { lat: 26.0739, lng: 83.1859 } },
  { id: 'bareilly', name: 'Bareilly', office: { lat: 28.367, lng: 79.4304 } },
  { id: 'chitrakoot', name: 'Chitrakoot Dham', office: { lat: 25.4776, lng: 80.3344 } },
  { id: 'devipatan', name: 'Devipatan', office: { lat: 27.1339, lng: 81.962 } },
  { id: 'etawah', name: 'Etawah', office: { lat: 26.7856, lng: 79.0158 } },
  { id: 'ghaziabad', name: 'Ghaziabad', office: { lat: 28.6692, lng: 77.4538 } },
  { id: 'gorakhpur', name: 'Gorakhpur', office: { lat: 26.7606, lng: 83.3732 } },
  { id: 'hardoi', name: 'Hardoi', office: { lat: 27.3965, lng: 80.1313 } },
  { id: 'jhansi', name: 'Jhansi', office: { lat: 25.4484, lng: 78.5685 } },
  { id: 'kanpur', name: 'Kanpur', office: { lat: 26.4499, lng: 80.3319 } },
  { id: 'lucknow', name: 'Lucknow', office: { lat: 26.8467, lng: 80.9462 } },
  { id: 'meerut', name: 'Meerut', office: { lat: 28.9845, lng: 77.7064 } },
  { id: 'moradabad', name: 'Moradabad', office: { lat: 28.8386, lng: 78.7733 } },
  { id: 'noida', name: 'Noida', office: { lat: 28.5355, lng: 77.391 } },
  { id: 'prayagraj', name: 'Prayagraj', office: { lat: 25.4358, lng: 81.8463 } },
  { id: 'saharanpur', name: 'Saharanpur', office: { lat: 29.968, lng: 77.551 } },
  { id: 'varanasi', name: 'Varanasi', office: { lat: 25.3176, lng: 82.9739 } },
];

export const UNPLACED_REGION_ID = 'unplaced';

const REGION_BY_ID: ReadonlyMap<string, Region> = new Map(REGIONS.map((r) => [r.id, r]));

export function regionById(id: string | null | undefined): Region | null {
  return id ? (REGION_BY_ID.get(id) ?? null) : null;
}

/** Names a region city goes by in depot names. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  ayodhya: ['ayodhya', 'faizabad'],
  prayagraj: ['prayagraj', 'allahabad'],
  devipatan: ['devipatan', 'gonda'],
  chitrakoot: ['chitrakoot', 'banda'],
};

function nameMatch(depotName: string): string | null {
  const name = depotName.toLowerCase();
  for (const region of REGIONS) {
    const words = ALIASES[region.id] ?? [region.name.toLowerCase()];
    if (words.some((word) => new RegExp(`\\b${word}\\b`).test(name))) return region.id;
  }
  return null;
}

/** The region a depot is placed in, or UNPLACED_REGION_ID when it has neither name nor position. */
export function regionOf(depot: Pick<DepotSummary, 'name' | 'centroid'>): string {
  const byName = nameMatch(depot.name);
  if (byName !== null) return byName;
  if (depot.centroid === null) return UNPLACED_REGION_ID;
  let best: { id: string; km: number } | null = null;
  for (const region of REGIONS) {
    const km = haversineKm(depot.centroid.lat, depot.centroid.lng, region.office.lat, region.office.lng);
    if (!best || km < best.km) best = { id: region.id, km };
  }
  return best?.id ?? UNPLACED_REGION_ID;
}

export interface RegionSummary {
  readonly region: Region;
  readonly depotIds: readonly string[];
  readonly fleet: number;
}

/** Every region that holds at least one depot, by name, with its depots and fleet. */
export function summariseRegions(depots: readonly DepotSummary[]): readonly RegionSummary[] {
  const byRegion = new Map<string, DepotSummary[]>();
  for (const depot of depots) {
    const id = regionOf(depot);
    const held = byRegion.get(id);
    if (held) held.push(depot);
    else byRegion.set(id, [depot]);
  }
  return REGIONS.filter((region) => byRegion.has(region.id)).map((region) => {
    const members = byRegion.get(region.id) ?? [];
    return {
      region,
      depotIds: members.map((d) => d.id),
      fleet: members.reduce((sum, d) => sum + d.fleet, 0),
    };
  });
}

/** The depots inside a region scope; every depot when no region is chosen. */
export function depotsInRegion<T extends Pick<DepotSummary, 'name' | 'centroid'>>(
  depots: readonly T[],
  regionId: string | null,
): readonly T[] {
  if (regionId === null) return depots;
  return depots.filter((depot) => regionOf(depot) === regionId);
}
