import type { DepotVehicleStatus } from '@/models/depotLive';
import type { DepotFeedEnvelope } from '../api';
import type { Coverage } from '../types';
import type { ModelledService, ServiceGroup } from './serviceModel';
import type { WorkshopLoad } from './workshop';

/** One bus the feed reports under maintenance, as the maintenance page lists it. */
export interface OffRoadBus {
  readonly registrationNumber: string;
  /** The feed's own `vehicle_status` word. */
  readonly vehicleStatus: DepotVehicleStatus;
  /** The feed's own `status` word, verbatim. */
  readonly tripStatus: string | null;
  /** Minutes since the bus last reported; null when unknown. */
  readonly gpsAgeMin: number | null;
  /** Device flags (main power off, tamper code), as on the roster. */
  readonly flags: readonly string[];
}

/** GET /api/upsrtc/depot/[depotId]/maintenance */
export interface MaintenanceResponse extends DepotFeedEnvelope {
  readonly depot: { readonly id: string; readonly name: string };
  /** Every bus whose state is off the road now. Straight from the feed. */
  readonly offRoad: { readonly provenance: 'live'; readonly buses: readonly OffRoadBus[] };
  /** How many of the depot's buses carry the feed's `distance` field at all. */
  readonly distanceCoverage: { readonly provenance: 'live'; readonly coverage: Coverage };
  /**
   * Preventive maintenance on a modelled odometer and service history. The
   * feed's `distance` is not used: its unit is unconfirmed.
   */
  readonly preventive: {
    readonly provenance: 'modelled';
    readonly dueSoonWithinKm: number;
    readonly counts: Readonly<Record<ServiceGroup, number>>;
    /** Most urgent first. */
    readonly buses: readonly ModelledService[];
  };
  /** Modelled bays against the live off-road count. */
  readonly workshop: {
    readonly provenance: 'modelled';
    readonly offRoadProvenance: 'live';
    readonly load: WorkshopLoad;
  };
}
