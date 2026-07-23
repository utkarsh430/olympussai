'use client';

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityConfig } from './quality';
import { scene, RANGES, phase, bell, damp, clamp01 } from './sceneState';
import { Globe } from './globe/Globe';

const GOLD_LIGHT = new THREE.Color('#f3c86a');
const COOL = new THREE.Color('#8fb3d9');
const IVORY = new THREE.Color('#f2eee7');

/** Soft radial sprite for additive points, generated once (no network asset). */
function useSprite(): THREE.Texture {
  return useMemo(() => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** Deep, slowly drifting background particle field with pointer parallax. */
function ParticleField({ count, sprite }: { count: number; sprite: THREE.Texture }) {
  const points = useRef<THREE.Points>(null);

  const { positions, colors, sizes, seeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Distribute in a wide, deep shell around the camera axis.
      const r = 4 + Math.pow(Math.random(), 0.6) * 22;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 18;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * r - 6;
      // Mostly cool/ivory motes, a gold minority.
      const t = Math.random();
      c.copy(t > 0.9 ? GOLD_LIGHT : t > 0.72 ? COOL : IVORY).multiplyScalar(0.5 + Math.random() * 0.5);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      sizes[i] = 0.02 + Math.random() * 0.06;
      seeds[i] = Math.random() * 100;
    }
    return { positions, colors, sizes, seeds };
  }, [count]);

  useFrame((_, dt) => {
    const p = points.current;
    if (!p) return;
    // Extremely slow rotation + gentle pointer parallax (background layer).
    p.rotation.y += dt * 0.008;
    p.position.x = damp(p.position.x, scene.smoothX * 0.5, 2, dt);
    p.position.y = damp(p.position.y, scene.smoothY * 0.5, 2, dt);
    // Recede slightly as the visitor ascends.
    const asc = phase(scene.progress, RANGES.ascent[0], RANGES.ascent[1]);
    p.position.z = damp(p.position.z, asc * 3, 1.5, dt);
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-seed" args={[seeds, 1]} />
      </bufferGeometry>
      <pointsMaterial
        map={sprite}
        vertexColors
        transparent
        size={0.14}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={0.9}
      />
    </points>
  );
}

/**
 * Root wrapper for the golden globe — the **outer** transform group.
 *
 * It preserves the exact scroll-driven narrative choreography the previous
 * halo used (emerge → swell through during the ascent → settle → reopen as the
 * portal gateway) as position.z + uniform scale. The visual body — near-black
 * core, golden continents, graticule, rim, and its own float/tilt/spin groups —
 * lives in <Globe> inside. The old halo rings, radial rays, ascending-peak line
 * and core glow sprite are intentionally removed.
 */
function OlympussCore({ config, sprite }: { config: QualityConfig; sprite: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const p = scene.progress;
    const arr = phase(p, RANGES.arrival[0], RANGES.arrival[1]);
    const exp = phase(p, RANGES.exploration[0], RANGES.exploration[1]);
    const intel = phase(p, RANGES.intelligence[0], RANGES.intelligence[1]);
    const portal = phase(p, RANGES.portal[0], RANGES.portal[1]);
    // Bell over the ascent range: grows to fill the view (passing through) then
    // settles back afterwards — unchanged from the previous object.
    const swell = bell(p, RANGES.ascent[0], RANGES.ascent[1]);

    const scaleTarget =
      0.95 + arr * 0.08 + swell * 2.6 - exp * 0.4 - intel * 0.12 + portal * 1.8;
    const s = damp(g.scale.x, Math.max(0.4, scaleTarget), 3, dt);
    g.scale.setScalar(s);

    // Drift toward the camera as it swells / reopens as the gateway.
    g.position.z = damp(g.position.z, swell * 1.3 - exp * 0.3 + portal * 1.2, 2.5, dt);
  });

  return (
    <group ref={group}>
      <Globe config={config} sprite={sprite} />
    </group>
  );
}

/** Five concept nodes orbiting the core during Fields of Exploration. */
function ConceptOrbits({ count, sprite }: { count: number; sprite: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const nodes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        radius: 2.4 + i * 0.55,
        speed: 0.12 - i * 0.012,
        phase: (i / count) * Math.PI * 2,
        tilt: (i - count / 2) * 0.16,
      })),
    [count],
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const exp = bell(scene.progress, RANGES.exploration[0], RANGES.exploration[1]);
    g.visible = exp > 0.01;
    const t = state.clock.elapsedTime;
    g.children.forEach((child, i) => {
      const n = nodes[i];
      if (!n) return;
      const active = scene.activeConcept === i;
      // Active node slows and draws slightly inward.
      const speed = active ? n.speed * 0.15 : n.speed;
      const a = n.phase + t * speed;
      const r = n.radius * (active ? 0.82 : 1);
      child.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.55 + n.tilt, Math.sin(a) * r * 0.4);
      const sprite = child as THREE.Sprite;
      const base = 0.28 + (active ? 0.3 : 0);
      sprite.scale.setScalar((base + 0.03 * Math.sin(t * 2 + i)) * (0.35 + exp * 0.55));
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.opacity = (active ? 1 : 0.55) * exp;
    });
  });

  return (
    <group ref={group} visible={false}>
      {nodes.map((_, i) => (
        <sprite key={i}>
          <spriteMaterial
            map={sprite}
            color={i % 2 === 0 ? GOLD_LIGHT : COOL}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

/** Signals→understanding: disordered particles converge into organized streams. */
function SignalField({ count, sprite }: { count: number; sprite: THREE.Texture }) {
  const points = useRef<THREE.Points>(null);

  const { chaos, order, colors } = useMemo(() => {
    const chaos = new Float32Array(count * 3);
    const order = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    const streams = 6;
    for (let i = 0; i < count; i++) {
      // Chaotic origin: mostly from the left and deep background.
      chaos[i * 3] = -6 - Math.random() * 8;
      chaos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      chaos[i * 3 + 2] = -4 - Math.random() * 8;
      // Organized destination: tidy horizontal streams converging right/centre.
      const s = i % streams;
      const along = (i / count) * 10 - 2;
      order[i * 3] = along;
      order[i * 3 + 1] = (s - streams / 2) * 0.5 + Math.sin(along) * 0.15;
      order[i * 3 + 2] = Math.cos(s) * 0.6;
      c.copy(i % 5 === 0 ? GOLD_LIGHT : COOL).multiplyScalar(0.6 + Math.random() * 0.4);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { chaos, order, colors };
  }, [count]);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(chaos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [chaos, colors]);

  useFrame((state) => {
    const pts = points.current;
    if (!pts || count === 0) return;
    const intel = phase(scene.progress, RANGES.intelligence[0], RANGES.intelligence[1]);
    pts.visible = intel > 0.01;
    const mat = pts.material as THREE.PointsMaterial;
    mat.opacity = Math.sin(clamp01(intel) * Math.PI) * 0.95;

    // Ease chaos→order with progress; add a little living jitter while chaotic.
    const e = intel < 0.5 ? 2 * intel * intel : 1 - Math.pow(-2 * intel + 2, 2) / 2;
    const arr = geo.getAttribute('position') as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;
    const jitter = (1 - e) * 0.04;
    for (let i = 0; i < count; i++) {
      const cx = chaos[i * 3] ?? 0;
      const cy = chaos[i * 3 + 1] ?? 0;
      const cz = chaos[i * 3 + 2] ?? 0;
      const ox = order[i * 3] ?? 0;
      const oy = order[i * 3 + 1] ?? 0;
      const oz = order[i * 3 + 2] ?? 0;
      arr.setXYZ(
        i,
        cx + (ox - cx) * e + Math.sin(t + i) * jitter,
        cy + (oy - cy) * e + Math.cos(t + i) * jitter,
        cz + (oz - cz) * e,
      );
    }
    arr.needsUpdate = true;
  });

  if (count === 0) return null;
  return (
    <points ref={points} geometry={geo} visible={false}>
      <pointsMaterial
        map={sprite}
        vertexColors
        transparent
        size={0.12}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={0}
      />
    </points>
  );
}

/** Camera dolly + parallax driven by scroll progress. */
function CameraRig() {
  const { camera } = useThree();
  useFrame((_, dt) => {
    // Smooth the pointer here (single source), read elsewhere.
    scene.smoothX = damp(scene.smoothX, scene.pointerX, 3, dt);
    scene.smoothY = damp(scene.smoothY, scene.pointerY, 3, dt);

    const p = scene.progress;
    const swell = bell(p, RANGES.ascent[0], RANGES.ascent[1]);
    const exp = phase(p, RANGES.exploration[0], RANGES.exploration[1]);
    const portal = phase(p, RANGES.portal[0], RANGES.portal[1]);

    // Dolly in through the swelling halo, ease back to frame the core/orbits,
    // then move toward the reopened gateway.
    const zTarget = 8.6 - swell * 2.6 + exp * 0.6 - portal * 1.4;
    camera.position.z = damp(camera.position.z, zTarget, 2, dt);
    camera.position.x = damp(camera.position.x, scene.smoothX * 0.4, 2.5, dt);
    camera.position.y = damp(camera.position.y, scene.smoothY * 0.3, 2.5, dt);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export function Scene({ config }: { config: QualityConfig }) {
  const sprite = useSprite();
  return (
    <>
      <fogExp2 attach="fog" args={['#050507', 0.028]} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#2a3d5c', '#050507', 0.4]} />
      <pointLight position={[0, 0, 2]} intensity={2.2} color={'#f3c86a'} distance={12} />
      <pointLight position={[-6, 3, -4]} intensity={0.5} color={'#4a6a9a'} />

      <CameraRig />
      <ParticleField count={config.bgParticles} sprite={sprite} />
      <OlympussCore config={config} sprite={sprite} />
      <ConceptOrbits count={config.orbitCount} sprite={sprite} />
      <SignalField count={config.signalParticles} sprite={sprite} />
    </>
  );
}
