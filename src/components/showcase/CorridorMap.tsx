'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createFleetLayer,
  type FleetLayerHandle,
  type FleetLayerPalette,
} from '@/components/map/fleetCanvasLayer';
import { MapFallback } from '@/components/map/MapFallback';
import { MAP_THEME } from '@/lib/constants';
import type { FleetMapOverlay, FleetMapOverlayMark } from '@/lib/maps/contract';
import { getMapsLoader, isMapsConfigured, onMapsAuthFailure } from '@/lib/maps/loader';
import type { CorridorRoute } from '@/lib/showcase/corridor';
import type { ReplayArm, ReplayFrame } from '@/lib/showcase/replayFrame';
import { cn } from '@/lib/utils';
import type { DataQuality } from '@/models/canonical';
import { ARM_LABEL, TacticalMap, type TacticalMapProps } from './TacticalMap';

/**
 * The live trial on a real basemap, with the tactical plot as its fallback.
 *
 * Same props as `TacticalMap`, and the same picture: the corridor as one
 * ink, a station at every stop, a chevron per bus, a dashed link over a
 * pair that is not fine, a ring and a HOLD label where a bus is being held,
 * and the arm named in text in the corner. The difference is what it sits
 * on. Here the corridor is drawn on Google's dark basemap so a viewer can
 * see the streets the route follows, and the buses are painted by the same
 * canvas layer the operations consoles use (`fleetCanvasLayer.ts`), so the
 * chevron a boardroom sees is the chevron a control room sees.
 *
 * The plot is the FALLBACK, never a second renderer: whenever the basemap
 * cannot be had - no key configured, the SDK failing to load, the Map
 * constructor throwing, or Google refusing the key for this origin after
 * the map has been built (`RefererNotAllowedMapError`, which leaves the
 * container white and the app none the wiser) - whatever was built is
 * disposed and `TacticalMap` takes over with the identical props. Nothing
 * upstream has to know which one is showing.
 *
 * The map is built ONCE per mount. A change of route replaces the polylines
 * and the station markers and re-fits the camera; a change of arm recolours
 * them without moving it; a new frame only hands the layer new marks.
 */
export type CorridorMapProps = TacticalMapProps;

type MapStatus = 'loading' | 'ready' | 'fallback';

/** A bus as the fleet layer draws it. Quality carries the state, so the SHAPE does too. */
export interface ReplayMark {
  id: string;
  latitude: number;
  longitude: number;
  headingDegrees: number;
  /** `degraded` (ringed, amber) while holding; `good` (filled, the arm ink) otherwise. */
  dataQuality: DataQuality;
}

/** The colours this renderer needs, resolved once at build time. */
export interface Ink {
  controlled: string;
  baseline: string;
  warning: string;
  danger: string;
  foreground: string;
  ground: string;
  muted: string;
}

/**
 * The documented value of every token read here, in the dark theme this
 * surface always runs in (`showcase.css` for `--sim-controlled`,
 * `globals.css` `.dark` for the rest). Used only when a token resolves to
 * nothing - a container with no themed ancestor, or a test DOM.
 */
const TOKEN_FALLBACK = {
  '--sim-controlled': '#3ab3c9',
  '--sim-baseline': '#7e93a6',
  '--instrument-warning': '#ffb020',
  '--instrument-danger': '#ff4d5e',
  '--foreground': '#dbeefb',
  '--background': '#02040a',
  '--muted-foreground': '#9fb6c9',
} as const;

/** Room the camera fit keeps around the corridor, in CSS pixels, on every side. */
const FIT_PADDING_PX = 48;