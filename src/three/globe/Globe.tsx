'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityConfig } from '../quality';
import { scene, damp } from '../sceneState';
import { DEG2RAD, sampleLandGrid, landPointsToPositions, buildGraticule } from './geo';
import { orbitPoint, orbitRing } from './orbits';
import { greatCircleArc, sampleArc, pickRoutes } from './arcs';
import { LAND_POLYGONS } from './landData';

/* ─────────────────────────  Tuning constants  ─────────────────────────
 * Every knob that shapes the globe's look lives here so it can be reviewed and
 * adjusted in one place (see the report's "exact tuning locations"). */

/** Sphere radius in world units. Matches the old core's on-screen footprint. */
export const GLOBE_RADIUS = 1.5;

/** Nearly-black, faintly warm core. Reads black; picks up a whisper of light. */
const CORE_COLOR = '#08070b';

/** Golden continent dots: base, brighter accent, and a pale glint for hotspots. */
const DOT_COLOR = new THREE.Color('#e0aa4e');
const DOT_COLOR_BRIGHT = new THREE.Color('#f6d489');
const DOT_GLINT = new THREE.Color('#fff0cf');

/** Restrained warm-gold graticule. */
const GRATICULE_COLOR = new THREE.Color('#b98731');
/** Thin premium atmospheric rim. */
const ATMO_COLOR = new THREE.Color('#eab861');

/** Orbital ecosystem palette. */
const ORBIT_COLOR = new THREE.Color('#c69542'); // deeper gold supporting line
const SAT_COLOR = new THREE.Color('#ffe6b0'); // bright orbiters
const SAT_COLOR_DIM = new THREE.Color('#d9a94e'); // subtle orbiters
const ORBIT_BASE_RADIUS = 1.92; // first orbit (globe radius is 1.5)
const ORBIT_RADIUS_STEP = 0.26;

/** Geographic network palette + geometry. */
const ARC_COLOR = new THREE.Color('#e9c074');
const ARC_GLINT_COLOR = new THREE.Color('#fff1d2');
const ARC_LIFT = 0.32; // arc altitude factor (longer routes rise higher)

/** Continuous globe spin — one revolution per this many seconds (Y axis). */
const SECONDS_PER_REV = 120;
/** Initial longitude offset so the Americas frame nicely (lng −90 faces +Z). */
const AMERICAS_OFFSET = -0.12;

/** Fixed axial tilt of the whole globe (roll + slight forward tip). */
const TILT_Z = -0.34; // ~ −19° roll, leans the north pole
const TILT_X = 0.12; //  ~ +7° forward tip

/** Very subtle idle life. */
const FLOAT_AMP = 0.03; // vertical bob (world units)
const FLOAT_SPEED = 0.5; // rad/s
const BREATHE_AMP = 0.01; // scale pulse
const BREATHE_SPEED = 0.7; // rad/s
/** Pointer parallax magnitude (matches the previous core's gentle tilt). */
const POINTER_TILT = 0.06;

/* ───────────────────────────  Atmospheric rim  ─────────────────────────── */

function makeAtmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: ATMO_COLOR },
      uPower: { value: 6.0 }, // higher → thinner, crisper rim
      uStrength: { value: 0.7 }, // overall rim brightness (restrained)
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uStrength;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosW);
        float rim = pow(1.0 - abs(dot(normalize(vNormalW), viewDir)), uPower);
        gl_FragColor = vec4(uColor, rim * uStrength);
      }
    `,
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
}

/* ─────────────────────  Orbital ecosystem (middle group)  ───────────────── */

/**
 * Inclined orbital paths + small satellite orbiters + tiny static markers.
 * Lives in the middle group (shares the globe's tilt/float but not its spin);
 * each satellite travels its own orbit. Everything depth-tests against the core
 * so orbiters correctly pass in front of and behind the globe.
 */
function OrbitalSystem({ config, sprite }: { config: QualityConfig; sprite: THREE.Texture }) {
  const g = config.globe;

  const orbits = useMemo(
    () =>
      Array.from({ length: g.orbitPaths }, (_, i) => {
        const radius = ORBIT_BASE_RADIUS + i * ORBIT_RADIUS_STEP;
        const inclination = (i % 2 ? 1 : -1) * (20 + i * 22) * DEG2RAD;
        const node = i * 47 * DEG2RAD;
        return { radius, inclination, node, positions: orbitRing(radius, inclination, node, g.orbitSegments) };
      }),
    [g.orbitPaths, g.orbitSegments],
  );

  const sats = useMemo(
    () =>
      Array.from({ length: g.satellites }, (_, i) => {
        const o = orbits[i % Math.max(1, orbits.length)];
        return {
          radius: o?.radius ?? ORBIT_BASE_RADIUS,
          inclination: o?.inclination ?? 0,
          node: o?.node ?? 0,
          angle0: i * 1.8,
          speed: (i % 2 ? -1 : 1) * (0.1 + (i % 3) * 0.045),
          bright: i < 2, // only the first couple are bright
        };
      }),
    [g.satellites, orbits],
  );

  const markerPos = useMemo(() => {
    const pts: number[] = [];
    for (let m = 0; m < g.markers; m++) {
      const o = orbits[m % Math.max(1, orbits.length)];
      if (!o) break;
      const [x, y, z] = orbitPoint(o.radius, o.inclination, o.node, m * 2.3);
      pts.push(x, y, z);
    }
    return new Float32Array(pts);
  }, [g.markers, orbits]);

  const satRefs = useRef<Array<THREE.Sprite | null>>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < sats.length; i++) {
      const spr = satRefs.current[i];
      const s = sats[i];
      if (!spr || !s) continue;
      const [x, y, z] = orbitPoint(s.radius, s.inclination, s.node, s.angle0 + t * s.speed);
      spr.position.set(x, y, z);
    }
  });

  return (
    <group>
      {orbits.map((o, i) => (
        <lineLoop key={i}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[o.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={ORBIT_COLOR}
            transparent
            opacity={0.14}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineLoop>
      ))}

      {g.markers > 0 && markerPos.length > 0 && (
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[markerPos, 3]} />
          </bufferGeometry>
          <pointsMaterial
            map={sprite}
            color={ORBIT_COLOR}
            transparent
            size={0.04}
            sizeAttenuation
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            opacity={0.6}
          />
        </points>
      )}

      {sats.map((s, i) => (
        <sprite
          key={i}
          ref={(el) => {
            satRefs.current[i] = el;
          }}
          scale={s.bright ? 0.11 : 0.075}
        >
          <spriteMaterial
            map={sprite}
            color={s.bright ? SAT_COLOR : SAT_COLOR_DIM}
            transparent
            opacity={s.bright ? 0.95 : 0.6}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

/* ───────────────────  Geographic arcs (inner / spinning group)  ─────────── */

/**
 * A modest set of great-circle "route" arcs between land points, each with a
 * bright highlight travelling along it. Anchored to geography so it spins with
 * the continents; depth-tests against the core for correct occlusion.
 */
function GeoArcs({
  landSamples,
  config,
  sprite,
}: {
  landSamples: ReadonlyArray<readonly [number, number]>;
  config: QualityConfig;
  sprite: THREE.Texture;
}) {
  const g = config.globe;
  const glints = useRef<THREE.Points>(null);

  const { linePositions, arcs } = useMemo(() => {
    const routes = pickRoutes(landSamples, g.arcs, 0x9e37);
    const arcs: Float32Array[] = [];
    const seg: number[] = [];
    for (const [i, j] of routes) {
      const A = landSamples[i]!;
      const B = landSamples[j]!;
      const arc = greatCircleArc(A[1], A[0], B[1], B[0], GLOBE_RADIUS * 1.004, ARC_LIFT, g.arcSegments);
      arcs.push(arc);
      const n = arc.length / 3;
      for (let s = 0; s < n - 1; s++) {
        seg.push(arc[s * 3]!, arc[s * 3 + 1]!, arc[s * 3 + 2]!);
        seg.push(arc[(s + 1) * 3]!, arc[(s + 1) * 3 + 1]!, arc[(s + 1) * 3 + 2]!);
      }
    }
    return { linePositions: new Float32Array(seg), arcs };
  }, [landSamples, g.arcs, g.arcSegments]);

  const glintPos = useMemo(() => new Float32Array(Math.max(1, arcs.length) * 3), [arcs.length]);

  useFrame((state) => {
    const p = glints.current;
    if (!p || arcs.length === 0) return;
    const t = state.clock.elapsedTime;
    const attr = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < arcs.length; k++) {
      const phase = (t * 0.13 + k * 0.37) % 1;
      const [x, y, z] = sampleArc(arcs[k]!, phase);
      attr.setXYZ(k, x, y, z);
    }
    attr.needsUpdate = true;
  });

  if (arcs.length === 0) return null;
  return (
    <group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={ARC_COLOR}
          transparent
          opacity={0.26}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points ref={glints}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[glintPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={sprite}
          color={ARC_GLINT_COLOR}
          transparent
          size={0.05}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.95}
        />
      </points>
    </group>
  );
}

/* ───────────────────────────────  Globe  ──────────────────────────────── */

/**
 * The golden globe's visual body. It provides the **middle** and **inner**
 * transform groups; the surrounding OlympussCore wrapper is the **outer** group
 * that keeps the existing scroll-driven position/scale choreography.
 *
 *  - middle group: subtle float + breathe + fixed axial tilt + pointer parallax;
 *    hosts the orbital ecosystem (own rotations, not the globe spin).
 *  - inner group : continuous Y-axis spin — core, continents, graticule, rim,
 *    and the geographic arc network (all anchored to geography).
 */
export function Globe({ config, sprite }: { config: QualityConfig; sprite: THREE.Texture }) {
  const middle = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const g = config.globe;

  // Deterministic land sample, shared by the continent dots and the arc network.
  const samples = useMemo(() => sampleLandGrid(LAND_POLYGONS, { stepDeg: g.stepDeg }), [g.stepDeg]);

  // Continent dots with a premium luminosity hierarchy (organic patches, a few
  // bright glints) built once from the sample.
  const dots = useMemo(() => {
    const positions = landPointsToPositions(samples, GLOBE_RADIUS * 1.002);
    const colors = new Float32Array(samples.length * 3);
    const c = new THREE.Color();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      const h = ((i * 2654435761) >>> 0) / 4294967296;
      // Low-frequency spatial variation → soft brightness patches across land.
      const patch = 0.5 + 0.5 * Math.sin(s[0] * 0.14) * Math.cos(s[1] * 0.19);
      const lum = 0.5 + 0.4 * patch + 0.12 * h;
      if (h > 0.965) {
        c.copy(DOT_GLINT); // ~3.5% pale-gold hotspots
      } else {
        c.copy(DOT_COLOR).lerp(DOT_COLOR_BRIGHT, h * 0.7).multiplyScalar(lum);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { positions, colors };
  }, [samples]);

  const graticule = useMemo(
    () =>
      buildGraticule({
        parallels: g.parallels,
        meridians: g.meridians,
        segments: g.graticuleSegments,
        radius: GLOBE_RADIUS * 1.0015,
      }),
    [g.parallels, g.meridians, g.graticuleSegments],
  );

  const atmosphereMaterial = useMemo(makeAtmosphereMaterial, []);

  useFrame((state, dt) => {
    const m = middle.current;
    const inr = inner.current;
    const t = state.clock.elapsedTime;

    if (m) {
      m.position.y = FLOAT_AMP * Math.sin(t * FLOAT_SPEED);
      m.scale.setScalar(1 + BREATHE_AMP * Math.sin(t * BREATHE_SPEED));
      m.rotation.x = damp(m.rotation.x, TILT_X + scene.smoothY * POINTER_TILT, 3, dt);
      m.rotation.y = damp(m.rotation.y, scene.smoothX * POINTER_TILT, 3, dt);
      m.rotation.z = TILT_Z;
    }
    if (inr) {
      inr.rotation.y = AMERICAS_OFFSET + t * ((Math.PI * 2) / SECONDS_PER_REV);
    }
  });

  return (
    <group ref={middle}>
      {/* Orbital ecosystem — shares tilt/float but not the globe spin. */}
      <OrbitalSystem config={config} sprite={sprite} />

      <group ref={inner}>
        {/* Nearly-black, depth-writing core — occludes the far-side dots/grid/arcs. */}
        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS, 64, 48]} />
          <meshStandardMaterial color={CORE_COLOR} roughness={1} metalness={0} />
        </mesh>

        {/* Golden continent points. */}
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dots.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[dots.colors, 3]} />
          </bufferGeometry>
          <pointsMaterial
            map={sprite}
            vertexColors
            transparent
            size={g.dotSize}
            sizeAttenuation
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            opacity={0.95}
          />
        </points>

        {/* Subtle lat/lng graticule (supports the globe, never overpowers dots). */}
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[graticule, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={GRATICULE_COLOR} transparent opacity={0.13} depthWrite={false} />
        </lineSegments>

        {/* Geographic arc network — spins with the continents. */}
        <GeoArcs landSamples={samples} config={config} sprite={sprite} />

        {/* Thin, crisp warm-gold atmospheric rim. */}
        {g.atmosphere && (
          <mesh material={atmosphereMaterial}>
            <sphereGeometry args={[GLOBE_RADIUS * 1.016, 48, 32]} />
          </mesh>
        )}
      </group>
    </group>
  );
}
