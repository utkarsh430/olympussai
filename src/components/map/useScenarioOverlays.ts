'use client';

import { useEffect, useRef } from 'react';
import { useCopilotStore } from '@/stores/copilotStore';
import type { BunchingScenario } from '@/lib/demo-scenarios/bunchingScenario';
import type { TrafficScenario } from '@/lib/demo-scenarios/trafficScenario';
import type { BreakdownScenario } from '@/lib/demo-scenarios/breakdownScenario';
import type { DemandScenario } from '@/lib/demo-scenarios/demandScenario';

type Overlay =
  | google.maps.Polyline
  | google.maps.Marker
  | google.maps.Circle
  | google.maps.Polygon;

/**
 * Draws all projected scenario geometry onto the map.
 *
 * Every shape here is generated locally by the scenario models. No live traffic
 * layer, no Routes API, no dispatched assistance vehicles.
 */
export function useScenarioOverlays(map: google.maps.Map | null): void {
  const scenario = useCopilotStore((state) => state.activeScenario);
  const schedule = useCopilotStore((state) => state.schedule);
  const overlaysRef = useRef<Overlay[]>([]);

  // ---- Live UPSRTC schedule geometry (stops + route polyline) -------------
  const scheduleOverlaysRef = useRef<Overlay[]>([]);

  useEffect(() => {
    if (!map) return;

    scheduleOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    scheduleOverlaysRef.current = [];

    if (!schedule) return;

    // Only stops with genuinely surveyed coordinates — upstream emits 0,0.
    const located = schedule.stops.filter(
      (stop) => stop.latitude !== null && stop.longitude !== null,
    );
    if (located.length === 0) return;

    const path = located.map((stop) => ({
      lat: stop.latitude as number,
      lng: stop.longitude as number,
    }));

    // A polyline is only drawn when we have enough reliable points to be honest.
    if (path.length >= 2) {
      const line = new google.maps.Polyline({
        path,
        map,
        strokeColor: '#22d9f5',
        strokeOpacity: 0.55,
        strokeWeight: 2.5,
        zIndex: 40,
      });
      scheduleOverlaysRef.current.push(line);
    }

    located.forEach((stop, index) => {
      const isOrigin = index === 0;
      const isDestination = index === located.length - 1;

      const marker = new google.maps.Marker({
        position: { lat: stop.latitude as number, lng: stop.longitude as number },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isOrigin || isDestination ? 6.5 : 3.6,
          fillColor: isOrigin ? '#2bff88' : isDestination ? '#ffb020' : '#22d9f5',
          fillOpacity: 0.9,
          strokeColor: '#02040a',
          strokeWeight: 1.5,
        },
        title: `${stop.sequence}. ${stop.name}`,
        zIndex: 60,
      });
      scheduleOverlaysRef.current.push(marker);
    });

    return () => {
      scheduleOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      scheduleOverlaysRef.current = [];
    };
  }, [map, schedule]);

  // ---- Projected scenario geometry ----------------------------------------
  useEffect(() => {
    if (!map) return;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    if (!scenario) return;

    const overlays: Overlay[] = [];

    if (scenario.kind === 'bunching') {
      const bunching = scenario as BunchingScenario;

      overlays.push(
        new google.maps.Polyline({
          path: bunching.corridorPath.map((p) => ({ lat: p.latitude, lng: p.longitude })),
          map,
          strokeColor: '#22d9f5',
          strokeOpacity: 0.7,
          strokeWeight: 5,
          zIndex: 30,
        }),
      );

      const ahead = bunching.markers.find((m) => m.role === 'ahead');
      const selected = bunching.markers.find((m) => m.role === 'selected');

      // Red convergence line between the two closing services.
      if (ahead && selected) {
        overlays.push(
          new google.maps.Polyline({
            path: [
              { lat: selected.latitude, lng: selected.longitude },
              { lat: ahead.latitude, lng: ahead.longitude },
            ],
            map,
            strokeColor: '#ff4d5e',
            strokeOpacity: 0,
            zIndex: 70,
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.95, strokeColor: '#ff4d5e', scale: 3.5 },
                offset: '0',
                repeat: '12px',
              },
            ],
          }),
        );

        // Pulsating bunching-risk zone at the convergence midpoint.
        overlays.push(
          new google.maps.Circle({
            map,
            center: {
              lat: (selected.latitude + ahead.latitude) / 2,
              lng: (selected.longitude + ahead.longitude) / 2,
            },
            radius: 900,
            strokeColor: '#ff4d5e',
            strokeOpacity: 0.55,
            strokeWeight: 1.5,
            fillColor: '#ff4d5e',
            fillOpacity: 0.12,
            zIndex: 20,
          }),
        );
      }

      for (const marker of bunching.markers) {
        if (marker.role === 'selected') continue; // real bus already drawn
        overlays.push(
          new google.maps.Marker({
            position: { lat: marker.latitude, lng: marker.longitude },
            map,
            icon: {
              path: 'M 0,-9 L 5.4,7 L 0,3.4 L -5.4,7 Z',
              fillColor: '#ffb020',
              fillOpacity: 0.95,
              strokeColor: '#ffb020',
              strokeOpacity: 0.5,
              strokeWeight: 2,
              scale: 1.5,
              rotation: marker.headingDegrees,
            },
            title: `${marker.label} (simulated)`,
            zIndex: 800,
          }),
        );
      }
    }

    if (scenario.kind === 'traffic') {
      const traffic = scenario as TrafficScenario;

      // Modelled congestion corridor — NOT Google traffic data.
      overlays.push(
        new google.maps.Polyline({
          path: traffic.congestionCorridor.map((p) => ({ lat: p.latitude, lng: p.longitude })),
          map,
          strokeColor: '#ff4d5e',
          strokeOpacity: 0.85,
          strokeWeight: 9,
          zIndex: 35,
        }),
      );

      for (const route of traffic.routes) {
        overlays.push(
          new google.maps.Polyline({
            path: route.path.map((p) => ({ lat: p.latitude, lng: p.longitude })),
            map,
            strokeColor: route.isRecommended ? '#3ff0ff' : '#7a8fa6',
            strokeOpacity: route.isRecommended ? 0.9 : 0.45,
            strokeWeight: route.isRecommended ? 4.5 : 3,
            zIndex: route.isRecommended ? 50 : 25,
            ...(route.isRecommended
              ? {}
              : {
                  icons: [
                    {
                      icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 2.5 },
                      offset: '0',
                      repeat: '14px',
                    },
                  ],
                }),
          }),
        );
      }

      overlays.push(
        new google.maps.Marker({
          position: { lat: traffic.incidentPoint.latitude, lng: traffic.incidentPoint.longitude },
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: '#ff4d5e',
            fillOpacity: 0.85,
            strokeColor: '#ffb0b8',
            strokeWeight: 2,
          },
          title: 'Projected incident',
          zIndex: 900,
        }),
      );

      overlays.push(
        new google.maps.Circle({
          map,
          center: { lat: traffic.incidentPoint.latitude, lng: traffic.incidentPoint.longitude },
          radius: 1400,
          strokeColor: '#ff4d5e',
          strokeOpacity: 0.4,
          strokeWeight: 1,
          fillColor: '#ff4d5e',
          fillOpacity: 0.1,
          zIndex: 15,
        }),
      );
    }

    if (scenario.kind === 'breakdown') {
      const breakdown = scenario as BreakdownScenario;
      const incident = breakdown.markers.find((m) => m.role === 'incident');

      if (incident) {
        [700, 1500, 2400].forEach((radius, index) => {
          overlays.push(
            new google.maps.Circle({
              map,
              center: { lat: incident.latitude, lng: incident.longitude },
              radius,
              strokeColor: '#ff4d5e',
              strokeOpacity: 0.5 - index * 0.13,
              strokeWeight: 1.5,
              fillColor: '#ff4d5e',
              fillOpacity: 0.09 - index * 0.028,
              zIndex: 10,
            }),
          );
        });
      }

      for (const candidate of breakdown.candidates) {
        overlays.push(
          new google.maps.Marker({
            position: { lat: candidate.latitude, lng: candidate.longitude },
            map,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: candidate.id === breakdown.recommendedCandidateId ? 8 : 6,
              fillColor: candidate.id === breakdown.recommendedCandidateId ? '#2bff88' : '#22d9f5',
              fillOpacity: 0.9,
              strokeColor: '#02040a',
              strokeWeight: 1.5,
            },
            title: `${candidate.id} — assistance candidate (${candidate.responseTimeMinutes} min)`,
            zIndex: 850,
          }),
        );

        if (incident) {
          overlays.push(
            new google.maps.Polyline({
              path: [
                { lat: candidate.latitude, lng: candidate.longitude },
                { lat: incident.latitude, lng: incident.longitude },
              ],
              map,
              strokeOpacity: 0,
              zIndex: 45,
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 0.7,
                    strokeColor:
                      candidate.id === breakdown.recommendedCandidateId ? '#2bff88' : '#22d9f5',
                    scale: 2.6,
                  },
                  offset: '0',
                  repeat: '10px',
                },
              ],
            }),
          );
        }
      }
    }

    if (scenario.kind === 'demand') {
      const demand = scenario as DemandScenario;

      for (const hotspot of demand.hotspots) {
        overlays.push(
          new google.maps.Circle({
            map,
            center: { lat: hotspot.latitude, lng: hotspot.longitude },
            radius: 800 + hotspot.intensity * 2600,
            strokeColor: hotspot.intensity > 0.66 ? '#ff4d5e' : '#ffb020',
            strokeOpacity: 0.35,
            strokeWeight: 1,
            fillColor: hotspot.intensity > 0.66 ? '#ff4d5e' : '#ffb020',
            fillOpacity: 0.08 + hotspot.intensity * 0.17,
            zIndex: 12,
          }),
        );
      }

      for (const arrow of demand.arrows) {
        overlays.push(
          new google.maps.Polyline({
            path: [
              { lat: arrow.from.latitude, lng: arrow.from.longitude },
              { lat: arrow.to.latitude, lng: arrow.to.longitude },
            ],
            map,
            strokeColor: '#3ff0ff',
            strokeOpacity: 0.75,
            strokeWeight: 3,
            zIndex: 55,
            icons: [
              {
                icon: {
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 3.5,
                  fillColor: '#3ff0ff',
                  fillOpacity: 1,
                  strokeOpacity: 0,
                },
                offset: '100%',
              },
            ],
          }),
        );
      }
    }

    overlaysRef.current = overlays;

    return () => {
      overlays.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [map, scenario]);
}
