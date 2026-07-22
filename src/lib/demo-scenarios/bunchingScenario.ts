import { SeededRandom, offsetCoordinate } from '@/lib/simulation/seededRandom';
import {
  SIMULATION_LABELS,
  type ScenarioBase,
  type ScenarioContext,
  type SimulatedBusMarker,
} from './types';

/**
 * Bus-bunching projection.
 *
 * The selected vehicle is real. The companion buses are modelled markers
 * placed relative to it — no headway mathematics is run against the live fleet.
 */

export interface BunchingScenario extends ScenarioBase {
  kind: 'bunching';
  targetHeadwayMinutes: number;
  gapAheadMinutes: number;
  gapBehindMinutes: number;
  riskPercent: number;
  clusteringPoint: string;
  minutesToBunching: number;
  projectedGapAheadAfter: number;
  projectedGapBehindAfter: number;
  holdSeconds: number;
  corridorPath: Array<{ latitude: number; longitude: number }>;
}

export function buildBunchingScenario(context: ScenarioContext): BunchingScenario {
  const { bus, schedule, overrides } = context;
  const random = new SeededRandom(`bunching:${bus.registrationNumber}`);

  const heading = bus.headingDegrees ?? random.int(0, 359);
  const targetHeadwayMinutes = 15;

  const gapAheadMinutes = overrides?.gapAheadMinutes ?? random.int(2, 4);
  const gapBehindMinutes = overrides?.gapBehindMinutes ?? random.int(21, 26);
  const riskPercent = overrides?.bunchingRisk ?? random.int(81, 92);
  const holdSeconds = overrides?.holdSeconds ?? 90;
  const minutesToBunching = random.int(6, 10);

  // Companion buses sit ahead of / behind the real bus along its heading.
  const aheadKm = random.fixed(0.8, 1.6, 2);
  const behindKm = random.fixed(5.5, 8.5, 2);

  const aheadPos = offsetCoordinate(bus.latitude, bus.longitude, aheadKm, heading);
  const behindPos = offsetCoordinate(bus.latitude, bus.longitude, behindKm, (heading + 180) % 360);

  const markers: SimulatedBusMarker[] = [
    {
      id: 'SIM-BUS-A',
      label: 'BUS AHEAD',
      role: 'ahead',
      headingDegrees: heading,
      isRealBus: false,
      ...aheadPos,
    },
    {
      id: bus.registrationNumber,
      label: 'SELECTED BUS',
      role: 'selected',
      headingDegrees: heading,
      isRealBus: true,
      latitude: bus.latitude,
      longitude: bus.longitude,
    },
    {
      id: 'SIM-BUS-C',
      label: 'BUS BEHIND',
      role: 'behind',
      headingDegrees: heading,
      isRealBus: false,
      ...behindPos,
    },
  ];

  // A gentle corridor polyline through all three markers for the map overlay.
  const corridorPath = [
    offsetCoordinate(bus.latitude, bus.longitude, behindKm + 2, (heading + 180) % 360),
    behindPos,
    { latitude: bus.latitude, longitude: bus.longitude },
    aheadPos,
    offsetCoordinate(bus.latitude, bus.longitude, aheadKm + 3, heading),
  ];

  const clusteringPoint =
    schedule?.stops.find((stop) => stop.sequence > 1)?.name ??
    schedule?.destinationName ??
    'Next major passenger stop';

  const projectedGapAheadAfter = gapAheadMinutes + Math.round(holdSeconds / 30);
  const projectedGapBehindAfter = Math.max(1, gapBehindMinutes - Math.round(holdSeconds / 30));

  const routeLabel = bus.routeName ?? schedule?.routeName ?? 'the scheduled corridor';

  return {
    kind: 'bunching',
    simulationLabel: SIMULATION_LABELS.bunching,
    headline: 'Bus bunching projected on the scheduled corridor',
    severity: riskPercent >= 85 ? 'warning' : 'advisory',
    severityText: riskPercent >= 85 ? 'Warning — intervention advised' : 'Advisory — monitor closely',
    confidencePercent: Math.min(97, riskPercent + random.int(1, 5)),
    observation:
      'The selected bus is closing the gap with the bus ahead while the bus behind remains significantly delayed. Without intervention, both buses are projected to arrive together at the next major passenger stop.',
    recommendation: `Hold the selected bus for ${holdSeconds} seconds at the next authorized bus station.`,
    expectedOutcome: `Forward gap recovers from ${gapAheadMinutes} minutes to approximately ${projectedGapAheadAfter} minutes, restoring a more even headway across ${routeLabel}.`,
    affectedBuses: ['BUS AHEAD', bus.registrationNumber, 'BUS BEHIND'],
    suggestedDriverMessageEn: `Please hold at the next authorized bus station for approximately ${holdSeconds} seconds to restore spacing between buses. Await control-room confirmation before departing.`,
    suggestedDriverMessageHi: `कृपया सेवा अंतराल ठीक करने के लिए अगले अधिकृत बस स्टेशन पर लगभग ${holdSeconds} सेकंड रुकें। प्रस्थान से पहले नियंत्रण कक्ष की पुष्टि की प्रतीक्षा करें।`,
    actions: [
      { id: 'accept', label: 'Accept Suggestion', kind: 'accept' },
      { id: 'modify', label: 'Modify Hold Duration', kind: 'modify' },
      { id: 'reject', label: 'Reject', kind: 'reject' },
      { id: 'monitor', label: 'Monitor Only', kind: 'monitor' },
      { id: 'message', label: 'Send Suggestion to Driver', kind: 'message' },
    ],
    markers,
    impact: [
      {
        label: 'Forward gap',
        before: `${gapAheadMinutes} min`,
        after: `${projectedGapAheadAfter} min`,
        improvement: 'up',
        delta: `+${projectedGapAheadAfter - gapAheadMinutes} min`,
      },
      {
        label: 'Rear gap',
        before: `${gapBehindMinutes} min`,
        after: `${projectedGapBehindAfter} min`,
        improvement: 'down',
        delta: `−${gapBehindMinutes - projectedGapBehindAfter} min`,
      },
      {
        label: 'Headway deviation',
        before: `${Math.abs(targetHeadwayMinutes - gapAheadMinutes)} min`,
        after: `${Math.abs(targetHeadwayMinutes - projectedGapAheadAfter)} min`,
        improvement: 'down',
        delta: 'Improved',
      },
    ],
    timeline: [
      { at: '00:00', label: 'Headway deviation detected' },
      { at: '00:06', label: 'Bunching projection generated' },
      { at: '00:15', label: 'Hold recommendation prepared' },
      { at: '00:30', label: 'Awaiting dispatcher authorization' },
      { at: `${String(minutesToBunching).padStart(2, '0')}:00`, label: 'Projected clustering without action' },
    ],
    seed: `bunching:${bus.registrationNumber}`,
    targetHeadwayMinutes,
    gapAheadMinutes,
    gapBehindMinutes,
    riskPercent,
    clusteringPoint,
    minutesToBunching,
    projectedGapAheadAfter,
    projectedGapBehindAfter,
    holdSeconds,
    corridorPath,
  };
}
