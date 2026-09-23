'use client';

/**
 * The client shell of /trial: the backdrop, the scenes, and the present-mode
 * chrome wired to one `usePresentMode`.
 *
 * The scenes are passed in as children from the server page, so this shell
 * renders nothing of the content itself. Nothing here puts a transform on an
 * ancestor of the children: the backdrop is `fixed`, and a transformed
 * ancestor would re-root every `position: fixed` element inside the scenes.
 */
import { useMemo, type ReactNode } from 'react';
import { FleetField } from './FleetField';
import { PresentChrome, type PresentScene } from './PresentChrome';
import { usePresentMode } from './usePresentMode';

const BASE_GRADIENT = 'linear-gradient(to bottom, hsl(var(--card)) 0%, hsl(var(--background)) 45%)';

// Three washes and a horizon: the teal one gives the top-left its light, the
// indigo one gives the bottom-right its depth, a faint warm one low on the
// left keeps the void from reading as a single blue, and a thin band at
// two-thirds height suggests a horizon behind everything.
const WASHES = [
  'radial-gradient(ellipse 70% 55% at 18% 8%, hsl(var(--primary) / 0.18), transparent 60%)',
  'radial-gradient(ellipse 60% 50% at 88% 92%, hsl(222 60% 40% / 0.22), transparent 62%)',
  'radial-gradient(ellipse 50% 40% at 6% 78%, hsl(var(--brand) / 0.06), transparent 65%)',
  'linear-gradient(180deg, transparent 60%, hsl(var(--primary) / 0.05) 67%, transparent 74%)',
].join(', ');

const DOT_GRID = 'radial-gradient(hsl(var(--primary) / 0.24) 0.9px, transparent 1px)';