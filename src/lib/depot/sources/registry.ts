/**
 * Every data feed the depot module uses or is waiting for.
 *
 * The two live feeds list the fields the code actually reads, with the caveats
 * the code documents. The others list the schema a real feed is expected to
 * provide, so a data owner can see exactly what to supply.
 */

export type FeedStatus = 'live' | 'modelled' | 'awaiting';

export interface FeedField {
  readonly name: string;
  readonly type: string;
  readonly note?: string;
}

export interface FeedEntry {
  readonly id: string;
  readonly name: string;
  readonly status: FeedStatus;
  readonly summary: string;
  readonly fields: readonly FeedField[];
  /** What supplying (or connecting) this feed makes possible. */
  readonly unlocks: string;
}

/** On-screen wording for each status. */
export const FEED_STATUS_LABEL: Readonly<Record<FeedStatus, string>> = {
  live: 'LIVE',
  modelled: 'MODELLED',
  awaiting: 'AWAITING FEED',
};

const FEED_TIME_NOTE =
  'Feed wall-clock time carrying a misleading Z suffix; read as written, never converted.';

const GPS_DEVICE: FeedEntry = {
  id: 'gps-device',
  name: 'GPS and device feed',
  status: 'live',
  summary: 'One record per bus from the corporation tracking API, read every poll.',
  unlocks: 'Everything on the live pages: fleet status, yards, the league table and exceptions.',
  fields: [
    { name: 'registrationNumber', type: 'string', note: 'The bus; the key every join uses.' },
    { name: 'latitude', type: 'number | null', note: 'Null when the bus has no valid position.' },
    { name: 'longitude', type: 'number | null' },
    { name: 'speedKmph', type: 'number | null' },
    { name: 'ignitionOn', type: 'boolean | null', note: 'The raw ignition line, not inferred.' },
    { name: 'gpsTimestamp', type: 'string | null', note: `Device fix time. ${FEED_TIME_NOTE}` },
    { name: 'receivedAt', type: 'string | null', note: `Server receipt time. ${FEED_TIME_NOTE}` },
    { name: 'depotId', type: 'string | null', note: 'Home depot, digits only.' },
    { name: 'depotName', type: 'string | null' },
    {
      name: 'vehicleStatus',
      type: 'live | stationary | no_signal | under_maintenance | unknown',
      note: 'From the feed vehicle_status only.',
    },
    {
      name: 'tripStatus',
      type: 'string | null',
      note: 'The feed status word, kept as sent (observed: Offline, Live, Stationary, Towing); a different vocabulary from vehicleStatus.',
    },
    { name: 'routeId', type: 'string | null' },
    { name: 'routeName', type: 'string | null' },
    { name: 'routeDescription', type: 'string | null' },
    { name: 'journeyId', type: 'string | null' },
    { name: 'journeyCode', type: 'string | null' },
    { name: 'scheduledStart', type: 'string | null', note: FEED_TIME_NOTE },
    { name: 'scheduledEnd', type: 'string | null', note: FEED_TIME_NOTE },
    { name: 'actualStart', type: 'string | null', note: FEED_TIME_NOTE },
    {
      name: 'delayMinutes',
      type: 'number | null',
      note: 'Delay in minutes, as sent. Implausible values are not shown as adherence.',
    },
    {
      name: 'odometerRaw',
      type: 'number | null',
      note: 'The unit is not yet confirmed, so it is never shown as kilometres.',
    },
    { name: 'mainPowerOn', type: 'boolean | null' },
    { name: 'mainVoltage', type: 'number | null' },
    {
      name: 'tamperCode',
      type: 'string | null',
      note: 'Raw code (observed C, W and O). Its meaning is not asserted here.',
    },
    { name: 'emergency', type: 'boolean | null' },
  ],
};

const ROUTE_DETAILS: FeedEntry = {
  id: 'route-details',
  name: 'Route details API',
  status: 'live',
  summary: "A bus's schedule for one date, with its ordered stops, fetched per bus on demand.",
  unlocks: 'Schedule coverage per bus and the stop list behind a trip.',
  fields: [
    { name: 'registrationNumber', type: 'string' },
    { name: 'date', type: 'string', note: 'YYYY-MM-DD the schedule applies to.' },
    { name: 'routeId', type: 'string | null' },
    { name: 'routeName', type: 'string | null' },
    { name: 'originName', type: 'string | null' },
    { name: 'destinationName', type: 'string | null' },
    { name: 'tripId', type: 'string | null' },
    { name: 'scheduledDeparture', type: 'string | null', note: FEED_TIME_NOTE },
    { name: 'scheduledArrival', type: 'string | null', note: FEED_TIME_NOTE },
    { name: 'direction', type: 'string | null' },
    {
      name: 'tripCount',
      type: 'number',
      note: 'Journeys listed for this bus on the date; the schedule describes the one it is running.',
    },
    { name: 'stops[].id', type: 'string' },
    { name: 'stops[].name', type: 'string' },
    { name: 'stops[].sequence', type: 'number' },
    {
      name: 'stops[].latitude',
      type: 'number | null',
      note: 'Some stops arrive as 0,0, which is not a position.',
    },
    { name: 'stops[].longitude', type: 'number | null' },
    { name: 'stops[].scheduledArrival', type: 'string | null', note: FEED_TIME_NOTE },
    { name: 'stops[].scheduledDeparture', type: 'string | null', note: FEED_TIME_NOTE },
  ],
};

const DEPOT_MASTER: FeedEntry = {
  id: 'depot-master',
  name: 'Depot master',
  status: 'awaiting',
  summary: 'The list of depots with their location and physical capacity.',
  unlocks: 'Real yard positions and bay capacity in place of inferred yards and modelled capacity.',
  fields: [
    { name: 'depotId', type: 'string', note: 'Matches the feed home depot.' },
    { name: 'name', type: 'string' },
    { name: 'kind', type: 'depot | hired | electric | enforcement' },
    { name: 'regionId', type: 'string', note: 'Enables the region scope.' },
    { name: 'latitude', type: 'number' },
    { name: 'longitude', type: 'number' },
    { name: 'parkingCapacity', type: 'integer', note: 'Buses the yard can hold.' },
    { name: 'bays', type: 'integer', note: 'Maintenance and washing bays.' },
  ],
};

const FLEET_MASTER: FeedEntry = {
  id: 'fleet-master',
  name: 'Fleet master',
  status: 'awaiting',
  summary: 'One record per registered bus with its type and age.',
  unlocks: 'Vehicle compatibility when proposing transfers between depots.',
  fields: [
    { name: 'registrationNumber', type: 'string' },
    { name: 'homeDepotId', type: 'string' },
    { name: 'busType', type: 'string', note: 'For example ordinary, semi-luxury, electric.' },
    { name: 'seats', type: 'integer' },
    { name: 'yearOfManufacture', type: 'integer' },
    { name: 'status', type: 'active | condemned | transferred' },
  ],
};

const TIMETABLE: FeedEntry = {
  id: 'network-timetable',
  name: 'Network timetable',
  status: 'awaiting',
  summary: 'Scheduled trips or vehicle blocks for the whole network, not only buses on the road.',
  unlocks: 'A real requirement per depot, so real surplus and deficit, and routes with no bus.',
  fields: [
    { name: 'routeId', type: 'string' },
    { name: 'tripId', type: 'string' },
    { name: 'depotId', type: 'string', note: 'Operating depot.' },
    { name: 'blockId', type: 'string', note: 'Trips one bus runs in a day.' },
    { name: 'direction', type: 'string' },
    { name: 'scheduledDeparture', type: 'time' },
    { name: 'scheduledArrival', type: 'time' },
    { name: 'daysOfOperation', type: 'string' },
    { name: 'stops[].stopId, sequence, latitude, longitude', type: 'record' },
  ],
};

const CREW: FeedEntry = {
  id: 'crew-duties',
  name: 'Crew and duties',
  status: 'awaiting',
  summary: 'Duty rosters and crew availability, reported as depot totals.',
  unlocks: 'Duty coverage against the timetable; crew shortfall per depot.',
  fields: [
    { name: 'depotId', type: 'string' },
    { name: 'date', type: 'date' },
    { name: 'dutyId', type: 'string' },
    { name: 'blockId', type: 'string', note: 'The block the duty covers.' },
    { name: 'dutyStart', type: 'time' },
    { name: 'dutyEnd', type: 'time' },
    { name: 'crewRequired', type: 'integer' },
    { name: 'crewAvailable', type: 'integer' },
  ],
};

const MAINTENANCE: FeedEntry = {
  id: 'maintenance',
  name: 'Maintenance',
  status: 'awaiting',
  summary: 'Work orders and the reason a bus is held off the road.',
  unlocks: 'Off-road reasons and expected return dates in place of a status flag alone.',
  fields: [
    { name: 'registrationNumber', type: 'string' },
    { name: 'workOrderId', type: 'string' },
    { name: 'category', type: 'string', note: 'For example engine, body, tyres, scheduled service.' },
    { name: 'openedAt', type: 'datetime' },
    { name: 'expectedReturn', type: 'datetime | null' },
    { name: 'closedAt', type: 'datetime | null' },
  ],
};

const FUEL: FeedEntry = {
  id: 'fuel',
  name: 'Fuel',
  status: 'awaiting',
  summary: 'Fuel issued per bus, with the odometer reading at the time.',
  unlocks: 'Fuel use per kilometre by depot, and a way to confirm the odometer unit.',
  fields: [
    { name: 'registrationNumber', type: 'string' },
    { name: 'date', type: 'date' },
    { name: 'litres', type: 'number' },
    { name: 'odometerKm', type: 'number', note: 'In kilometres.' },
    { name: 'depotId', type: 'string' },
  ],
};

const TICKETING: FeedEntry = {
  id: 'ticketing-ridership',
  name: 'Ticketing and ridership',
  status: 'awaiting',
  summary: 'Tickets sold and revenue per trip, from the ticketing machines.',
  unlocks: 'Revenue and load per route and depot; demand-based requirement.',
  fields: [
    { name: 'tripId', type: 'string' },
    { name: 'registrationNumber', type: 'string' },
    { name: 'date', type: 'date' },
    { name: 'passengers', type: 'integer' },
    { name: 'revenue', type: 'number', note: 'In rupees.' },
    { name: 'kilometresOperated', type: 'number' },
  ],
};

const HISTORY: FeedEntry = {
  id: 'history-store',
  name: 'History store',
  status: 'awaiting',
  summary: 'A daily snapshot of every depot kept over time.',
  unlocks: 'Real trends in place of a single snapshot; the history chart stops being MODELLED.',
  fields: [
    { name: 'snapshotAt', type: 'datetime', note: 'Feed time of the snapshot.' },
    { name: 'depotId', type: 'string' },
    { name: 'fleet', type: 'integer' },
    { name: 'onRoad, offRoad, dark, standing', type: 'integer', note: 'Bus counts by state.' },
    { name: 'reporting', type: 'integer' },
    { name: 'efficiencyIndex', type: 'number | null' },
  ],
};

export const FEED_REGISTRY: readonly FeedEntry[] = [
  GPS_DEVICE,
  ROUTE_DETAILS,
  DEPOT_MASTER,
  FLEET_MASTER,
  TIMETABLE,
  CREW,
  MAINTENANCE,
  FUEL,
  TICKETING,
  HISTORY,
];
