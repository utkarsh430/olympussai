'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { CanonicalLiveBus } from '@/models/canonical';

/**
 * Futuristic radar sweep + pulsing rings anchored to the selected bus.
 * Purely decorative HUD chrome projected over the basemap.
 */
export function RadarSweep({ map, bus }: { map: google.maps.Map; bus: CanonicalLiveBus }) {
  const reduced = useReducedMotion();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    let queued = false;

    const project = () => {
      const projection = map.getProjection();
      const bounds = map.getBounds();
      if (!projection || !bounds) {
        setPoint(null);
        return;
      }

      const position = new google.maps.LatLng(bus.latitude, bus.longitude);
      if (!bounds.contains(position)) {
        setPoint(null);
        return;
      }

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const topRight = projection.fromLatLngToPoint(ne);
      const bottomLeft = projection.fromLatLngToPoint(sw);
      const target = projection.fromLatLngToPoint(position);
      if (!topRight || !bottomLeft || !target) return;

      const div = map.getDiv();
      const width = div.clientWidth;
      const height = div.clientHeight;

      const x = ((target.x - bottomLeft.x) / (topRight.x - bottomLeft.x)) * width;
      const y = ((target.y - topRight.y) / (bottomLeft.y - topRight.y)) * height;
      setPoint({ x, y });
    };

    // bounds_changed fires continuously while dragging. Coalescing to one
    // projection per animation frame turns a re-render storm into 60/s max.
    const scheduleProject = () => {
      if (queued) return;
      queued = true;
      frame = requestAnimationFrame(() => {
        queued = false;
        project();
      });
    };

    const listeners = [
      map.addListener('bounds_changed', scheduleProject),
      map.addListener('zoom_changed', scheduleProject),
      map.addListener('idle', scheduleProject),
    ];

    frame = requestAnimationFrame(project);

    return () => {
      cancelAnimationFrame(frame);
      listeners.forEach((listener) => listener.remove());
    };
  }, [map, bus.latitude, bus.longitude]);

  if (!point) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20"
      style={{ left: point.x, top: point.y, transform: 'translate(-50%, -50%)' }}
    >
      <div className="relative h-[240px] w-[240px]">
        {/* Rotating sweep cone */}
        {!reduced && (
          <div
            className="absolute inset-0 animate-radar-sweep rounded-full"
            style={{
              background:
                'conic-gradient(from 0deg, hsl(var(--primary) / 0.34) 0deg, hsl(var(--primary) / 0.10) 26deg, transparent 58deg, transparent 360deg)',
              maskImage: 'radial-gradient(circle, black 62%, transparent 71%)',
              WebkitMaskImage: 'radial-gradient(circle, black 62%, transparent 71%)',
            }}
          />
        )}

        {/* Static range rings */}
        {[0.32, 0.56, 0.82].map((scale) => (
          <div
            key={scale}
            className="absolute rounded-full border border-holo-glow/25"
            style={{
              inset: `${((1 - scale) / 2) * 100}%`,
            }}
          />
        ))}

        {/* Expanding pulse */}
        {!reduced &&
          [0, 1.2].map((delay) => (
            <div
              key={delay}
              className="absolute inset-[38%] animate-pulse-ring rounded-full border border-holo-glow/60"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}

        {/* Crosshair */}
        <div className="absolute left-1/2 top-1/2 h-px w-14 -translate-x-1/2 -translate-y-1/2 bg-holo-glow/45" />
        <div className="absolute left-1/2 top-1/2 h-14 w-px -translate-x-1/2 -translate-y-1/2 bg-holo-glow/45" />

        <div className="absolute left-1/2 top-[calc(50%+22px)] -translate-x-1/2 whitespace-nowrap rounded border border-holo-glow/40 bg-void-900/85 px-2 py-0.5 font-mono text-[9px] tracking-widest text-holo-glow">
          {bus.registrationNumber}
        </div>
      </div>
    </div>
  );
}
