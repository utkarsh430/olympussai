import { SeededRandom, offsetCoordinate } from '@/lib/simulation/seededRandom';
import { SIMULATION_LABELS, type ScenarioBase, type ScenarioContext } from './types';

/**
 * Corridor traffic projection.
 *
 * Explicitly does NOT use Google TrafficLayer, the Google Routes API, or any
 * live traffic source. The congestion corridor and alternative route are
 * generated locally as geometry offsets from the selected vehicle.
 */

export interface RouteOption {
  id: string;
  name: string;
  etaMinutes: number;
  distanceKm: number;
  averageSpeedKmph: number;
  description: string;
  isRecommended: boolean;
  path: Array<{ latitude: number; longitude: number }>;
}

export interface TrafficDensityPoint {
  distanceKm: number;
  speedKmph: number;
  densityPercent: number;
}

export interface TrafficScenario extends ScenarioBase {
  kind: 'traffic';
  congestionLevel: 'Moderate' | 'Heavy' | 'Severe';
  distanceToCongestionKm: number;
  trafficDelayMinutes: number;
  predictedCorridorSpeedKmph: number;
  normalEtaMinutes: number;
  congestedEtaMinutes: number;
  alternativeEtaMinutes: number;
  potentialSavingMinutes: number;
  incidentDescription: string;
  incidentPoint: { latitude: number; longitude: number };
  congestionCorridor: Array<{ latitude: number; longitude: number }>;
  routes: RouteOption[];
  densityCurve: TrafficDensityPoint[];
  recommendations: string[];
  safetyNote: string;
}

const INCIDENTS = [
  'Lane obstruction reported near a major junction',
  'Roadworks narrowing the carriageway to a single lane',
  'Heavy market-hour congestion around the town centre',
  'Slow-moving goods traffic on the approach to the bypass',
] as const;

export function buildTrafficScenario(context: ScenarioContext): TrafficScenario {
  const { bus, schedule, overrides } = context;
  const random = new SeededRandom(`traffic:${bus.registrationNumber}`);

  const heading = bus.headingDegrees ?? random.int(0, 359);

  const severityKey = overrides?.congestionSeverity ?? random.pick(['heavy', 'severe'] as const);
  const congestionLevel = (
    severityKey === 'severe' ? 'Severe' : severityKey === 'heavy' ? 'Heavy' : 'Moderate'
  ) as TrafficScenario['congestionLevel'];

  const distanceToCongestionKm = overrides?.congestionDistanceKm ?? random.fixed(2.4, 7.8, 1);
  const trafficDelayMinutes = overrides?.trafficDelayMinutes ?? random.int(14, 22);
  const predictedCorridorSpeedKmph = random.int(7, 13);
  const normalEtaMinutes = random.int(36, 48);
  const congestedEtaMinutes = normalEtaMinutes + trafficDelayMinutes;
  const potentialSavingMinutes = overrides?.alternativeSavingMinutes ?? random.int(9, 14);
  const alternativeEtaMinutes = congestedEtaMinutes - potentialSavingMinutes;

  const incidentPoint = offsetCoordinate(bus.latitude, bus.longitude, distanceToCongestionKm, heading);

  // Congestion corridor: a short stretch of road centred on the incident.
  const congestionCorridor = [
    offsetCoordinate(bus.latitude, bus.longitude, distanceToCongestionKm - 0.8, heading),
    incidentPoint,
    offsetCoordinate(bus.latitude, bus.longitude, distanceToCongestionKm + 1.9, heading),
  ];

  const mainPath = [
    { latitude: bus.latitude, longitude: bus.longitude },
    ...congestionCorridor,
    offsetCoordinate(bus.latitude, bus.longitude, distanceToCongestionKm + 6, heading),
  ];

  // Alternative: bear off the corridor then rejoin further along.
  const detourBearing = (heading + 52) % 360;
  const alternativePath = [
    { latitude: bus.latitude, longitude: bus.longitude },
    offsetCoordinate(bus.latitude, bus.longitude, 1.6, detourBearing),
    offsetCoordinate(bus.latitude, bus.longitude, 4.2, (heading + 24) % 360),
    offsetCoordinate(bus.latitude, bus.longitude, distanceToCongestionKm + 3.4, (heading + 8) % 360),
    offsetCoordinate(bus.latitude, bus.longitude, distanceToCongestionKm + 6, heading),
  ];

  const routeLabel = schedule?.routeName ?? bus.routeName ?? 'Scheduled corridor';

  const routes: RouteOption[] = [
    {
      id: 'current',
      name: 'CURRENT ROUTE',
      etaMinutes: congestedEtaMinutes,
      distanceKm: random.fixed(18, 26, 1),
      averageSpeedKmph: predictedCorridorSpeedKmph,
      description: `${routeLabel} — passes directly through the projected congestion corridor.`,
      isRecommended: false,
      path: mainPath,
    },
    {
      id: 'alternative',
      name: 'SUGGESTED ALTERNATIVE',
      etaMinutes: alternativeEtaMinutes,
      distanceKm: random.fixed(20, 29, 1),
      averageSpeedKmph: random.int(28, 38),
      description:
        'Bypasses the congested stretch and rejoins the scheduled corridor while retaining major passenger stops.',
      isRecommended: true,
      path: alternativePath,
    },
  ];

  // Speed profile across the corridor — dips hard at the incident.
  const densityCurve: TrafficDensityPoint[] = Array.from({ length: 12 }, (_, index) => {
    const distanceKm = Number((index * (distanceToCongestionKm + 4) / 11).toFixed(1));
    const proximity = Math.abs(distanceKm - distanceToCongestionKm);
    const congestionFactor = Math.max(0, 1 - proximity / 2.5);
    const speedKmph = Math.round(46 - congestionFactor * (46 - predictedCorridorSpeedKmph));
    return {
      distanceKm,
      speedKmph,
      densityPercent: Math.round(28 + congestionFactor * 66),
    };
  });

  return {
    kind: 'traffic',
    simulationLabel: SIMULATION_LABELS.traffic,
    headline: `${congestionLevel} congestion projected ${distanceToCongestionKm} km ahead`,
    severity: congestionLevel === 'Severe' ? 'warning' : 'advisory',
    severityText:
      congestionLevel === 'Severe'
        ? 'Warning — significant delay projected'
        : 'Advisory — moderate delay projected',
    confidencePercent: random.int(84, 94),
    observation:
      'Traffic-intelligence models predict sustained congestion along the scheduled corridor. The alternative route is projected to reduce delay while maintaining connectivity with major passenger stops.',
    recommendation: `Prepare the alternative corridor. Projected saving of ${potentialSavingMinutes} minutes against the congested route, subject to dispatcher authorization.`,
    expectedOutcome: `Arrival recovers from ${congestedEtaMinutes} minutes to approximately ${alternativeEtaMinutes} minutes.`,
    affectedBuses: [bus.registrationNumber],
    suggestedDriverMessageEn:
      'Traffic congestion is expected ahead. Maintain the approved safe speed and await further instructions from the control room.',
    suggestedDriverMessageHi:
      'आगे यातायात की भीड़ की संभावना है। स्वीकृत सुरक्षित गति बनाए रखें और नियंत्रण कक्ष के अगले निर्देश की प्रतीक्षा करें।',
    actions: [
      { id: 'accept', label: 'Accept Suggestion', kind: 'accept' },
      { id: 'modify', label: 'Modify', kind: 'modify' },
      { id: 'reject', label: 'Reject', kind: 'reject' },
      { id: 'monitor', label: 'Monitor Only', kind: 'monitor' },
      { id: 'message', label: 'Send to Driver', kind: 'message' },
    ],
    markers: [
      {
        id: bus.registrationNumber,
        label: 'SELECTED SERVICE',
        role: 'selected',
        headingDegrees: heading,
        isRealBus: true,
        latitude: bus.latitude,
        longitude: bus.longitude,
      },
      {
        id: 'SIM-INCIDENT',
        label: 'PROJECTED INCIDENT',
        role: 'incident',
        headingDegrees: heading,
        isRealBus: false,
        ...incidentPoint,
      },
    ],
    impact: [
      {
        label: 'Projected arrival',
        before: `${congestedEtaMinutes} min`,
        after: `${alternativeEtaMinutes} min`,
        improvement: 'down',
        delta: `−${potentialSavingMinutes} min`,
      },
      {
        label: 'Corridor speed',
        before: `${predictedCorridorSpeedKmph} km/h`,
        after: `${routes[1]?.averageSpeedKmph ?? 32} km/h`,
        improvement: 'up',
        delta: 'Improved',
      },
      {
        label: 'Delay against schedule',
        before: `${trafficDelayMinutes} min`,
        after: `${Math.max(0, trafficDelayMinutes - potentialSavingMinutes)} min`,
        improvement: 'down',
        delta: `−${potentialSavingMinutes} min`,
      },
    ],
    timeline: [
      { at: '00:00', label: 'Corridor scan initiated' },
      { at: '00:09', label: 'Congestion signature identified' },
      { at: '00:18', label: 'Alternative corridor evaluated' },
      { at: '00:26', label: 'Recommendation prepared' },
      { at: '00:40', label: 'Awaiting dispatcher authorization' },
    ],
    seed: `traffic:${bus.registrationNumber}`,
    congestionLevel,
    distanceToCongestionKm,
    trafficDelayMinutes,
    predictedCorridorSpeedKmph,
    normalEtaMinutes,
    congestedEtaMinutes,
    alternativeEtaMinutes,
    potentialSavingMinutes,
    incidentDescription: random.pick(INCIDENTS),
    incidentPoint,
    congestionCorridor,
    routes,
    densityCurve,
    recommendations: [
      'Maintain approved safe speed while approaching congestion.',
      'Hold at the next authorized stop if instructed by the control room.',
      'Use the highlighted alternative route after dispatcher authorization.',
    ],
    safetyNote: 'Route diversion and driver instructions require authorized dispatcher approval.',
  };
}
