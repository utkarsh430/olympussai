export const PRODUCT_NAME = 'OLYMPUSS AI';
export const PRODUCT_SUBTITLE = 'Predictive Fleet Command Intelligence';

export const LIVE_POLL_INTERVAL_MS = 15_000;

/** Uttar Pradesh geographic centre — default map camera. */
export const DEFAULT_MAP_CENTER = { lat: 26.85, lng: 80.95 };
export const DEFAULT_MAP_ZOOM = 7;
export const SELECTED_BUS_ZOOM = 13;

export const FOOTER_DISCLAIMER =
  'Prototype. Vehicle positions and schedules are live UPSRTC data. Alerts, forecasts, recommendations and communication events are model projections pending dispatcher review — not confirmed operational events. No driver is contacted and no instruction is executed.';

export const LIVE_LABELS = {
  gps: 'LIVE UPSRTC GPS',
  schedule: 'LIVE UPSRTC SCHEDULE',
  fixture: 'UPSRTC FIXTURE FALLBACK',
  liveData: 'LIVE UPSRTC DATA',
  /** The upstream did not answer and nothing real is held — no data is shown at all. */
  unavailable: 'UPSTREAM UNAVAILABLE',
} as const;

/** Copilot status states shown on the intelligence core. */
export const AI_STATES = [
  'Listening',
  'Analysing',
  'Recommendation Ready',
  'Awaiting Authorization',
  'Monitoring',
] as const;
export type AiState = (typeof AI_STATES)[number];

/** Ambient copilot lines. Local templates only — no LLM is called. */
export const AI_AMBIENT_LINES = [
  'Fleet telemetry synchronized.',
  'Potential operational disruption identified.',
  'Intervention analysis prepared for dispatcher review.',
  'Dispatcher authorization is required.',
  'Communication channel prepared.',
  'Network impact projection updated.',
  'Corridor monitoring active across connected depots.',
  'Headway variance within tolerance on monitored services.',
] as const;

export const MAP_DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#06080f' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#06080f' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4a6a86' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#123048' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#5f8fb0' }],
  },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#14304a' }] },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1b4568' }],
  },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#03060d' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#080d18' }] },
];

/**
 * The daylight basemap.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * The basemap is a JavaScript style array handed to the Maps SDK, not CSS, so
 * no theme class can reach it. Until this existed, choosing light mode gave you
 * a light console sitting over a black map — most visible, and least
 * defensible, on the driver's phone, which is the one surface in this product
 * read outdoors in direct sunlight. A dark basemap in sunlight is not a style
 * preference; it is unreadable.
 *
 * ─── SAME STRUCTURE, INVERTED GROUND ─────────────────────────────────────
 *
 * Deliberately a mirror of MAP_DARK_STYLE feature-for-feature rather than a
 * fresh design: the same features are hidden (poi, road labels, transit), so a
 * corridor drawn on one reads identically on the other and nothing appears or
 * disappears when a driver flips the theme. Only the grounds and label fills
 * are re-solved for a light page.
 *
 * Roads stay the lighter shape against their landscape, exactly as on the dark
 * map — white carriageway on a grey ground, with a mid-slate casing so the
 * edge survives at low zoom. What is preserved across the two styles is that
 * figure/ground RELATIONSHIP, not the absolute lightness: keeping the road the
 * brighter shape means a corridor overlay reads the same way in both themes,
 * and the casing is what stops white road on near-white land collapsing.
 */
export const MAP_LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#eef2f7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#eef2f7' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#546a82' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#c3d0de' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3d5772' }],
  },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#9db2c8' }],
  },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cddced' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#e6ecf3' }] },
];
