/**
 * Bus marker artwork for the simulator maps.
 *
 * Drawn as inline SVG data URIs rather than raster pins: no network asset is
 * fetched (the production CSP allows `data:` images but no third-party image
 * hosts), the letter stays crisp at every device pixel ratio, and each bus can
 * carry both its chain identity (A/B/C/D) and the UPSRTC service label in one
 * icon. Must be called after the Maps SDK has loaded — the returned object
 * references `google.maps.Point`/`Size`.
 */

import { BUS_COLORS } from '@/lib/bunching/config';
import type { BusId } from '@/lib/bunching/types';

/** Icon footprint. The anchor sits on the badge centre, not the caption. */
const WIDTH = 46;
const HEIGHT = 44;
const BADGE_CX = 23;
const BADGE_CY = 15;

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function busMarkerIcon(
  bus: BusId,
  options: { alert?: boolean } = {},
): google.maps.Icon {
  const color = BUS_COLORS[bus];
  const alertRing = options.alert
    ? `<circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="17.5" fill="none" stroke="#ff4d5e" stroke-width="1.4" stroke-dasharray="3 3" opacity="0.95"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${alertRing}
  <circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="12.5" fill="#02040a" fill-opacity="0.92" stroke="${color}" stroke-width="2"/>
  <circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="12.5" fill="${color}" fill-opacity="0.16"/>
  <text x="${BADGE_CX}" y="${BADGE_CY + 4.6}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="13" font-weight="700" fill="${color}">${bus}</text>
  <text x="${BADGE_CX}" y="${HEIGHT - 7}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="7" letter-spacing="0.7" fill="${color}" fill-opacity="0.72">UPSRTC</text>
</svg>`;

  return {
    url: svgToDataUri(svg),
    scaledSize: new google.maps.Size(WIDTH, HEIGHT),
    anchor: new google.maps.Point(BADGE_CX, BADGE_CY),
  };
}

/** Small text plaque used for incident and terminal labels on the basemap. */
export function labelPlaqueIcon(text: string, color: string): google.maps.Icon {
  // 5.6px per character is a close enough advance width for this font size to
  // keep the plaque snug without measuring text in the DOM.
  const width = Math.max(60, Math.round(text.length * 5.6) + 18);
  const height = 20;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0.6" y="0.6" width="${width - 1.2}" height="${height - 1.2}" rx="3" fill="#02040a" fill-opacity="0.88" stroke="${color}" stroke-width="1"/>
  <text x="${width / 2}" y="${height / 2 + 3.4}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="8.5" letter-spacing="0.4" fill="${color}">${text.toUpperCase()}</text>
</svg>`;

  return {
    url: svgToDataUri(svg),
    scaledSize: new google.maps.Size(width, height),
    anchor: new google.maps.Point(width / 2, -6),
  };
}
