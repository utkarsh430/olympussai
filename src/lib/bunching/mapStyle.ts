/**
 * Light basemap styling for the bunching simulator.
 *
 * The dashboard's `MAP_DARK_STYLE` is deliberately left untouched — it belongs
 * to the command centre's dark HUD. This is its light counterpart, built on the
 * same principles: suppress POIs, transit and road labels so the only things
 * competing for attention are the corridor polyline and the four buses.
 */

export const SIMULATION_MAP_LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f4f7fa' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7f92' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#dfe6ee' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#54697c' }],
  },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d7e0ea' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbe7f2' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#eef2f7' }] },
];

/** Basemap backdrop while tiles load — matches the light landscape colour. */
export const SIMULATION_MAP_BACKGROUND = '#eef2f7';

/** Corridor polyline and stop colours for the light basemap. */
export const SIMULATION_MAP_COLORS = {
  corridor: '#0b6e87',
  terminal: '#0b6b40',
  stop: '#0b6e87',
  stopStroke: '#ffffff',
  incident: '#b3172f',
  gap: '#8a5200',
  inactive: '#5b6e7e',
} as const;
