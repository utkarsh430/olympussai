'use client';

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Scene } from './Scene';
import { detectQuality, type QualityConfig } from './quality';
import { scene } from './sceneState';

/**
 * Fixed, decorative WebGL layer behind the landing content.
 *
 * - Chooses a quality tier from device capability, not viewport width.
 * - For the `reduced` tier (reduced-motion preference or no WebGL) it renders
 *   nothing, leaving the static CSS backdrop as a deliberate static edition.
 * - GSAP ScrollTrigger tracks whole-page scroll into the scene singleton
 *   (native scroll, reversible, no scroll-jacking).
 * - Pauses the render loop when the tab is hidden.
 */
export default function ExperienceCanvas() {
  const [config, setConfig] = useState<QualityConfig | null>(null);
  const [frameloop, setFrameloop] = useState<'always' | 'never'>('always');

  useEffect(() => {
    setConfig(detectQuality());
  }, []);

  // Scroll progress via GSAP ScrollTrigger.
  useEffect(() => {
    if (!config || !config.animate) return;
    gsap.registerPlugin(ScrollTrigger);
    const st = ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        scene.progress = self.progress;
      },
    });
    // Ensure correct measurement once fonts/layout settle.
    const raf = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => {
      cancelAnimationFrame(raf);
      st.kill();
    };
  }, [config]);

  // Pointer parallax (skipped on touch/low where it isn't meaningful).
  useEffect(() => {
    if (!config || !config.animate || config.tier === 'low') return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      scene.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      scene.pointerY = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [config]);

  // Pause the loop when the tab is hidden.
  useEffect(() => {
    const onVis = () => {
      scene.hidden = document.hidden;
      setFrameloop(document.hidden ? 'never' : 'always');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const gl = useMemo(
    () => ({ antialias: config?.tier === 'high', alpha: true, powerPreference: 'high-performance' as const }),
    [config],
  );

  if (!config || !config.animate) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <Canvas
        frameloop={frameloop}
        dpr={config.dpr}
        gl={gl}
        camera={{ position: [0, 0, 9], fov: 50, near: 0.1, far: 100 }}
      >
        <Scene config={config} />
      </Canvas>
    </div>
  );
}
