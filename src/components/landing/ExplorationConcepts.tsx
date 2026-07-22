'use client';

import { useEffect, useState } from 'react';
import { scene } from '@/three/sceneState';

const CONCEPTS = [
  {
    title: 'Machine Intelligence',
    body: 'Systems that interpret information, identify relationships, and reason across context.',
  },
  {
    title: 'Agentic Systems',
    body: 'Intelligent software capable of planning, acting, and coordinating toward defined objectives.',
  },
  {
    title: 'Real-Time Intelligence',
    body: 'Transforming continuous streams of information into immediate awareness and understanding.',
  },
  {
    title: 'Adaptive Automation',
    body: 'Digital processes that respond to changing conditions rather than following a single fixed path.',
  },
  {
    title: 'Human–AI Interaction',
    body: 'Interfaces that make advanced intelligence understandable, accessible, and useful.',
  },
] as const;

/**
 * Fields of Exploration concept selector (Section 24). Hover OR keyboard focus
 * OR tap activates a concept — no hover dependency, generous hit areas — and
 * writes the active index into the scene so the matching orbit node reacts.
 * Other concepts dim; the active description is always shown as real text.
 */
export function ExplorationConcepts() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    scene.activeConcept = active;
    return () => {
      scene.activeConcept = null;
    };
  }, [active]);

  const current = CONCEPTS[active]!;

  return (
    <div className="mt-16 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-16">
      {/* Concept list */}
      <ul className="flex flex-col gap-1" role="tablist" aria-label="Fields of exploration">
        {CONCEPTS.map((concept, i) => {
          const isActive = i === active;
          return (
            <li key={concept.title}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                className={`group flex w-full items-center gap-4 rounded-md px-3 py-4 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold ${
                  isActive ? 'opacity-100' : 'opacity-45 hover:opacity-80'
                }`}
              >
                <span
                  aria-hidden
                  className={`font-sans text-[11px] tabular-nums transition-colors ${
                    isActive ? 'text-ol-gold' : 'text-ol-muted'
                  }`}
                >
                  0{i + 1}
                </span>
                <span
                  aria-hidden
                  className={`h-px transition-all ${isActive ? 'w-10 bg-ol-gold' : 'w-4 bg-ol-muted/50'}`}
                />
                <span
                  className={`ol-display text-2xl transition-colors sm:text-3xl ${
                    isActive ? 'text-ol-ivory' : 'text-ol-text-secondary'
                  }`}
                >
                  {concept.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Active description */}
      <div className="flex min-h-[160px] items-center md:pl-8" aria-live="polite">
        <div>
          <p className="ol-eyebrow mb-4">Field 0{active + 1}</p>
          <p className="ol-display max-w-md text-2xl leading-snug text-ol-ivory sm:text-3xl">
            {current.body}
          </p>
        </div>
      </div>
    </div>
  );
}
