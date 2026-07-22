import { SeededRandom, offsetCoordinate } from '@/lib/simulation/seededRandom';
import { SIMULATION_LABELS, type ScenarioBase, type ScenarioContext } from './types';

/**
 * Demand and fleet-redistribution projection.
 *
 * The heatmap, route deficits and redistribution plan are generated from local
 * models rather than measured ridership.
 */

export const TIME_WINDOWS = ['06:00', '08:00', '10:00', '13:00', '17:00', '20:00'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  '06:00': '6 AM',
  '08:00': '8 AM',
  '10:00': '10 AM',
  '13:00': '1 PM',
  '17:00': '5 PM',
  '20:00': '8 PM',
};

/** Relative demand intensity per window — drives the heatmap and charts. */
const WINDOW_INTENSITY: Record<TimeWindow, number> = {
  '06:00': 0.72,
  '08:00': 1.34,
  '10:00': 0.88,
  '13:00': 0.79,
  '17:00': 1.46,
  '20:00': 0.94,
};

/**
 * The 08:00 morning peak is the reference window: at that setting the scenario
 * reproduces the documented baseline figures exactly (Route A 7→11 at 164%,
 * Route B 9→6 at 72%, Route C 8→9 at 118%). Every other window is expressed
 * relative to it, so the deficit/surplus story stays legible as the presenter
 * moves the time slider.
 */
const REFERENCE_INTENSITY = WINDOW_INTENSITY['08:00'];

export interface RouteDemand {
  id: string;
  name: string;
  currentBuses: number;
  requiredBuses: number;
  deficit: number;
  demandPercent: number;
  status: 'deficit' | 'surplus' | 'balanced';
}

export interface DemandHotspot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  intensity: number;
  waitingPassengers: number;
}

export interface DepotAvailability {
  depot: string;
  available: number;
  reserve: number;
  committed: number;
}

export interface ReallocationArrow {
  id: string;
  fromRouteId: string;
  toRouteId: string;
  buses: number;
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
}

export interface DemandCurvePoint {
  window: string;
  morningDemand: number;
  eveningDemand: number;
  capacity: number;
}

export interface DemandScenario extends ScenarioBase {
  kind: 'demand';
  activeWindow: TimeWindow;
  routes: RouteDemand[];
  hotspots: DemandHotspot[];
  depots: DepotAvailability[];
  arrows: ReallocationArrow[];
  demandCurve: DemandCurvePoint[];
  recommendations: string[];
  festivalSurge: boolean;
}

export function buildDemandScenario(context: ScenarioContext): DemandScenario {
  const { bus, schedule, overrides } = context;
  const random = new SeededRandom(`demand:${bus.registrationNumber}`);

  const activeWindow = overrides?.peakWindow ?? '08:00';
  const multiplier = overrides?.demandMultiplier ?? 1;
  const festivalSurge = overrides?.festivalSurge ?? false;
  const reserveBuses = overrides?.reserveBuses ?? random.int(2, 5);

  const intensity =
    ((WINDOW_INTENSITY[activeWindow] ?? REFERENCE_INTENSITY) / REFERENCE_INTENSITY) *
    multiplier *
    (festivalSurge ? 1.28 : 1);

  const corridorName = schedule?.routeName ?? bus.routeName ?? 'CORRIDOR';
  const depotLabel = bus.depotName ?? 'REGIONAL DEPOT';

  const routeSpecs = [
    { id: 'route-a', name: `${corridorName} — Route A`, base: 7, demandBase: 164 },
    { id: 'route-b', name: `${corridorName} — Route B`, base: 9, demandBase: 72 },
    { id: 'route-c', name: `${corridorName} — Route C`, base: 8, demandBase: 118 },
  ];

  const routes: RouteDemand[] = routeSpecs.map((spec) => {
    const demandPercent = Math.round(spec.demandBase * intensity);
    const requiredBuses = Math.max(1, Math.round((spec.base * demandPercent) / 100));
    const deficit = requiredBuses - spec.base;
    return {
      id: spec.id,
      name: spec.name,
      currentBuses: spec.base,
      requiredBuses,
      deficit,
      demandPercent,
      status: deficit > 0 ? 'deficit' : deficit < 0 ? 'surplus' : 'balanced',
    };
  });

  // Hotspots scattered around the selected bus so the heatmap sits on-screen.
  const hotspots: DemandHotspot[] = Array.from({ length: 9 }, (_, index) => {
    const bearing = (index * 40 + random.int(0, 25)) % 360;
    const distance = random.fixed(1.5, 11, 1);
    const position = offsetCoordinate(bus.latitude, bus.longitude, distance, bearing);
    const localIntensity = Math.min(1, random.float(0.35, 1) * intensity);
    return {
      id: `hotspot-${index + 1}`,
      name: `Demand cluster ${index + 1}`,
      intensity: localIntensity,
      waitingPassengers: Math.round(localIntensity * random.int(60, 180)),
      ...position,
    };
  });

  const depots: DepotAvailability[] = [
    { depot: depotLabel, available: random.int(4, 9), reserve: reserveBuses, committed: random.int(18, 34) },
    { depot: `${depotLabel} — Satellite`, available: random.int(2, 6), reserve: random.int(1, 3), committed: random.int(9, 19) },
  ];

  const surplusRoute = routes.find((route) => route.status === 'surplus');
  const deficitRoute = routes.find((route) => route.status === 'deficit');

  const arrows: ReallocationArrow[] =
    surplusRoute && deficitRoute
      ? [
          {
            id: 'realloc-1',
            fromRouteId: surplusRoute.id,
            toRouteId: deficitRoute.id,
            buses: Math.min(2, Math.abs(surplusRoute.deficit)),
            from: offsetCoordinate(bus.latitude, bus.longitude, 7, 220),
            to: offsetCoordinate(bus.latitude, bus.longitude, 6, 40),
          },
          {
            id: 'realloc-2',
            fromRouteId: 'depot-reserve',
            toRouteId: deficitRoute.id,
            buses: 1,
            from: offsetCoordinate(bus.latitude, bus.longitude, 9, 310),
            to: offsetCoordinate(bus.latitude, bus.longitude, 5, 70),
          },
        ]
      : [];

  const demandCurve: DemandCurvePoint[] = TIME_WINDOWS.map((window) => {
    const base = WINDOW_INTENSITY[window] ?? 1;
    return {
      window: TIME_WINDOW_LABELS[window],
      morningDemand: Math.round(base * 100 * (window <= '10:00' ? 1.15 : 0.7) * multiplier),
      eveningDemand: Math.round(base * 100 * (window >= '13:00' ? 1.2 : 0.65) * multiplier),
      capacity: 100,
    };
  });

  return {
    kind: 'demand',
    simulationLabel: SIMULATION_LABELS.demand,
    headline: `Peak-hour demand imbalance projected at ${TIME_WINDOW_LABELS[activeWindow]}`,
    severity: intensity > 1.2 ? 'warning' : 'advisory',
    severityText:
      intensity > 1.2 ? 'Warning — sustained overcrowding projected' : 'Advisory — demand imbalance detected',
    confidencePercent: random.int(82, 91),
    observation: `Demand modelling projects concentrated passenger loading across the ${corridorName} corridor during the ${TIME_WINDOW_LABELS[activeWindow]} window${festivalSurge ? ', amplified by a festival surge profile' : ''}. Current allocation leaves high-demand routes short while adjacent routes run below capacity.`,
    recommendation:
      'Rebalance the corridor: move surplus vehicles to the deficit route, release one depot reserve, and open a temporary short service.',
    expectedOutcome:
      'Average passenger waiting time approximately halves and overcrowding returns within acceptable limits across the corridor.',
    affectedBuses: [bus.registrationNumber],
    suggestedDriverMessageEn:
      'Your service has been included in a temporary corridor rebalancing. Await revised allocation details from the control room before departing.',
    suggestedDriverMessageHi:
      'आपकी सेवा को अस्थायी कॉरिडोर पुनर्संतुलन में शामिल किया गया है। प्रस्थान से पहले नियंत्रण कक्ष से संशोधित आवंटन विवरण की प्रतीक्षा करें।',
    actions: [
      { id: 'accept', label: 'Accept Redistribution Plan', kind: 'accept' },
      { id: 'modify', label: 'Modify Allocation', kind: 'modify' },
      { id: 'reject', label: 'Reject', kind: 'reject' },
      { id: 'monitor', label: 'Review After 30 Minutes', kind: 'monitor' },
    ],
    markers: [
      {
        id: bus.registrationNumber,
        label: 'SELECTED SERVICE',
        role: 'selected',
        headingDegrees: bus.headingDegrees ?? 0,
        isRealBus: true,
        latitude: bus.latitude,
        longitude: bus.longitude,
      },
    ],
    impact: [
      {
        label: 'Passenger waiting time',
        before: `${Math.round(28 * intensity)} min`,
        after: `${Math.round(14 * intensity)} min`,
        improvement: 'down',
        delta: '−50%',
      },
      {
        label: 'Estimated overcrowding',
        before: `${Math.round(148 * intensity)}%`,
        after: `${Math.round(94 * intensity)}%`,
        improvement: 'down',
        delta: 'Within limits',
      },
      {
        label: 'Fleet utilization',
        before: '71%',
        after: '88%',
        improvement: 'up',
        delta: '+17 pts',
      },
    ],
    timeline: [
      { at: '00:00', label: 'Demand profile evaluated' },
      { at: '00:12', label: 'Route imbalance identified' },
      { at: '00:24', label: 'Redistribution plan generated' },
      { at: '00:38', label: 'Awaiting dispatcher authorization' },
      { at: '30:00', label: 'Scheduled distribution review' },
    ],
    seed: `demand:${bus.registrationNumber}`,
    activeWindow,
    routes,
    hotspots,
    depots,
    arrows,
    demandCurve,
    festivalSurge,
    recommendations: [
      `Move two buses from ${surplusRoute?.name ?? 'the surplus route'} to ${deficitRoute?.name ?? 'the deficit route'}.`,
      `Dispatch one reserve bus from ${depotLabel}.`,
      'Start one temporary short service across the highest-demand segment.',
      'Review distribution after 30 minutes.',
    ],
  };
}
