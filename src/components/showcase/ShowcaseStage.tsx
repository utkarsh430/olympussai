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
const DOT_GRID_MASK = 'linear-gradient(to bottom, black 20%, transparent 95%)';

const VIGNETTE =
  'radial-gradient(ellipse 80% 70% at 50% 45%, transparent 55%, hsl(var(--background)) 100%)';

/**
 * The ground under every scene: a layered, quiet, slightly luminous surface
 * rather than a flat void.
 *
 * Bottom to top: a vertical base from the card tone into the background; a
 * teal wash upper-left and a deep blue wash lower-right; a fine dot grid that
 * fades out toward the bottom; the fleet, drawn as a network field at a
 * fraction of its ink; and a vignette plus a bottom fade that pull the edges
 * back into the void. The field is the only thing that moves, and it drifts
 * at half the hero's pace; under reduced motion the canvas loop draws it once
 * and stops, so every layer is still there without the motion.
 *
 * Nothing pulses, glows or flickers, and no layer carries a transform. The
 * field's ink is its canvas's computed `color`, so it follows the accent
 * token rather than carrying a colour. `data-showcase-backdrop` is what the
 * print stylesheet hides, so paper gets the report alone.
 */
function ShowcaseBackdrop() {
  return (
    <div
      aria-hidden
      data-showcase-backdrop
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute inset-0" style={{ background: BASE_GRADIENT }} />
      <div className="absolute inset-0" style={{ background: WASHES }} />
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage: DOT_GRID,
          backgroundSize: '26px 26px',
          maskImage: DOT_GRID_MASK,
          WebkitMaskImage: DOT_GRID_MASK,
        }}
      />
      <div className="absolute inset-0 text-primary opacity-[0.28]">
        <FleetField mode="network" points={4_000} speed={0.5} />
      </div>
      <div className="absolute inset-0" style={{ background: VIGNETTE }} />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

export function ShowcaseStage({
  scenes,
  children,
}: {
  scenes: readonly PresentScene[];
  children: ReactNode;
}) {
  const sceneIds = useMemo(() => scenes.map((scene) => scene.id), [scenes]);
  const present = usePresentMode({ sceneIds });

  return (
    <>
      <ShowcaseBackdrop />
      <div className="relative z-10">{children}</div>
      <PresentChrome
        active={present.state.active}
        index={present.state.index}
        scenes={scenes}
        onEnter={() => present.enter()}
        onExit={present.exit}
        onNext={present.next}
        onPrev={present.prev}
        onGoTo={present.goTo}
      />
    </>
  );
}
