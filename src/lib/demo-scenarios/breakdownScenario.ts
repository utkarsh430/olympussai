import { SeededRandom, offsetCoordinate } from '@/lib/simulation/seededRandom';
import { SIMULATION_LABELS, type ScenarioBase, type ScenarioContext } from './types';

/**
 * Breakdown response coordination.
 *
 * The assistance candidates are modelled. No real vehicle is dispatched and no
 * depot is notified — candidates are ordered by a locally generated
 * suitability score.
 */

export interface RescueCandidate {
  id: string;
  distanceKm: number;
  responseTimeMinutes: number;
  availableSeats: number;
  routeCompatibility: string;
  suitability: 'Recommended' | 'Suitable' | 'Reserve option';
  suitabilityScore: number;
  latitude: number;
  longitude: number;
  depot: string;
}

export interface BreakdownScenario extends ScenarioBase {
  kind: 'breakdown';
  breakdownType: string;
  passengersOnboard: number;
  locationSafetyStatus: string;
  candidates: RescueCandidate[];
  recommendedCandidateId: string;
  secondaryArrivalMinutes: number;
  responseTimeline: Array<{ at: string; label: string }>;
}

const BREAKDOWN_TYPES = [
  'Engine overheating',
  'Air-brake pressure loss',
  'Transmission fault',
  'Electrical system failure',
] as const;

const COMPATIBILITY = [
  'Same corridor — direct transfer possible',
  'Adjacent corridor — short diversion required',
  'Depot reserve — full re-route required',
] as const;

export function buildBreakdownScenario(context: ScenarioContext): BreakdownScenario {
  const { bus, overrides } = context;
  const random = new SeededRandom(`breakdown:${bus.registrationNumber}`);

  const breakdownType = overrides?.breakdownType ?? random.pick(BREAKDOWN_TYPES);
  const passengersOnboard = overrides?.passengerCount ?? random.int(38, 52);
  const candidateCount = overrides?.rescueCandidateCount ?? 3;
  const primaryResponse = overrides?.responseTimeMinutes ?? random.int(9, 13);

  const depotLabel = bus.depotName ?? 'REGIONAL DEPOT';

  const candidates: RescueCandidate[] = Array.from({ length: candidateCount }, (_, index) => {
    const distanceKm = random.fixed(2.5 + index * 3.2, 5.5 + index * 3.6, 1);
    const responseTimeMinutes = index === 0 ? primaryResponse : primaryResponse + random.int(4, 9) * index;
    const availableSeats = random.int(18, 36);
    const suitabilityScore = Math.max(
      42,
      96 - index * random.int(11, 18) - Math.round(distanceKm),
    );

    const bearing = random.int(0, 359);
    const position = offsetCoordinate(bus.latitude, bus.longitude, distanceKm, bearing);

    return {
      id: `RESCUE-0${index + 1}`,
      distanceKm,
      responseTimeMinutes,
      availableSeats,
      routeCompatibility: COMPATIBILITY[Math.min(index, COMPATIBILITY.length - 1)] as string,
      suitability: index === 0 ? 'Recommended' : index === 1 ? 'Suitable' : 'Reserve option',
      suitabilityScore,
      depot: index === 0 ? depotLabel : `${depotLabel} (adjacent)`,
      ...position,
    };
  });

  const recommended = candidates[0];
  const secondary = candidates[1];

  return {
    kind: 'breakdown',
    simulationLabel: SIMULATION_LABELS.breakdown,
    headline: `Critical vehicle fault — ${breakdownType.toLowerCase()}`,
    severity: 'critical',
    severityText: 'Critical — immediate response required',
    confidencePercent: random.int(90, 97),
    observation: `Vehicle telemetry indicates ${breakdownType.toLowerCase()} on the selected service. ${passengersOnboard} passengers are recorded onboard and roadside assistance is required at the current location.`,
    recommendation: `Dispatch ${recommended?.id ?? 'RESCUE-01'} to accommodate priority passengers and request depot support for remaining passengers.`,
    expectedOutcome: `Priority passengers transferred within approximately ${recommended?.responseTimeMinutes ?? primaryResponse} minutes, with secondary assistance arriving at ${secondary?.responseTimeMinutes ?? primaryResponse + 6} minutes.`,
    affectedBuses: [bus.registrationNumber, ...candidates.map((candidate) => candidate.id)],
    suggestedDriverMessageEn:
      'Assistance has been arranged for your location. Please ensure passenger safety away from the carriageway and await the assistance service. Confirm receipt to the control room.',
    suggestedDriverMessageHi:
      'आपके स्थान के लिए सहायता की व्यवस्था कर दी गई है। कृपया यात्रियों की सुरक्षा सड़क से दूर सुनिश्चित करें और सहायता सेवा की प्रतीक्षा करें। नियंत्रण कक्ष को प्राप्ति की पुष्टि करें।',
    actions: [
      { id: 'accept', label: 'Approve Assistance', kind: 'accept' },
      { id: 'call-rescue', label: 'Contact Rescue Driver', kind: 'call' },
      { id: 'call-breakdown', label: 'Contact Breakdown Driver', kind: 'call' },
      { id: 'notify-depot', label: 'Notify Depot', kind: 'notify' },
      { id: 'voip', label: 'Open VoIP Call', kind: 'call' },
      { id: 'notice', label: 'Generate Passenger Notice', kind: 'generate' },
    ],
    markers: [
      {
        id: bus.registrationNumber,
        label: 'VEHICLE FAULT — SELECTED SERVICE',
        role: 'incident',
        headingDegrees: bus.headingDegrees ?? 0,
        isRealBus: true,
        latitude: bus.latitude,
        longitude: bus.longitude,
      },
      ...candidates.map((candidate) => ({
        id: candidate.id,
        label: candidate.id,
        role: 'rescue' as const,
        headingDegrees: 0,
        isRealBus: false,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      })),
    ],
    impact: [
      {
        label: 'Passenger transfer time',
        before: '46 min',
        after: `${recommended?.responseTimeMinutes ?? primaryResponse} min`,
        improvement: 'down',
        delta: 'Faster response',
      },
      {
        label: 'Passengers accommodated',
        before: '0',
        after: `${recommended?.availableSeats ?? 31} of ${passengersOnboard}`,
        improvement: 'up',
        delta: 'Priority group covered',
      },
      {
        label: 'Depot notification',
        before: 'Manual call chain',
        after: 'Single authorized action',
        improvement: 'down',
        delta: 'Streamlined',
      },
    ],
    timeline: [],
    responseTimeline: [
      { at: '00:00', label: 'Breakdown detected' },
      { at: '00:08', label: 'Control-room alert generated' },
      { at: '00:20', label: 'Assistance candidates identified' },
      { at: '00:35', label: 'Dispatcher approves response' },
      { at: '00:50', label: 'Driver contacted' },
      {
        at: `${String(recommended?.responseTimeMinutes ?? primaryResponse).padStart(2, '0')}:00`,
        label: 'Assistance expected',
      },
    ],
    seed: `breakdown:${bus.registrationNumber}`,
    breakdownType,
    passengersOnboard,
    locationSafetyStatus: 'Roadside assistance required',
    candidates,
    recommendedCandidateId: recommended?.id ?? 'RESCUE-01',
    secondaryArrivalMinutes: secondary?.responseTimeMinutes ?? primaryResponse + 6,
  };
}
