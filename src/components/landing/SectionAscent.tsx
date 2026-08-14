import { Reveal } from './Reveal';

const TERMS = ['Perceive', 'Reason', 'Adapt', 'Create', 'Coordinate', 'Evolve'];

/**
 * Scene 02 — The Ascent (Section 23). Accessible equivalent of the WebGL
 * fly-through: the progressive terms are real text laid out at varied depth
 * (scale/opacity), not a standard list.
 */
export function SectionAscent() {
  return (
    <section
      id="ascent"
      aria-label="The Ascent"
      className="relative flex min-h-[165vh] flex-col justify-center px-6 py-32"
    >
      <div className="mx-auto w-full max-w-5xl">
        <Reveal>
          <p className="ol-eyebrow">The Ascent</p>
          <h2 className="ol-display ol-h2 mt-5 max-w-3xl text-foreground">
            Beyond computation lies intelligence.
          </h2>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="ol-measure-wide mt-8 space-y-5">
            <p className="ol-body">
              Technology is moving beyond systems that simply execute instructions. The next
              generation of intelligence interprets context, discovers patterns, adapts to change,
              and works alongside people.
            </p>
            <p className="ol-body text-subtle">
              Olympuss AI is a space for exploring that transition.
            </p>
          </div>
        </Reveal>

        {/* Progressive terms — depth via scale and opacity, not a list. */}
        <Reveal delay={0.1}>
          <ul
            className="mt-24 flex flex-wrap items-baseline gap-x-10 gap-y-6"
            aria-label="Directions of intelligence"
          >
            {TERMS.map((term, i) => {
              const scales = [
                'text-2xl',
                'text-4xl',
                'text-3xl',
                'text-5xl',
                'text-3xl',
                'text-4xl',
              ];
              const opacities = [
                'opacity-45',
                'opacity-80',
                'opacity-60',
                'opacity-100',
                'opacity-55',
                'opacity-75',
              ];
              return (
                <li
                  key={term}
                  className={`ol-display ${scales[i]} ${opacities[i]} ${i % 3 === 1 ? 'text-brand' : 'text-foreground'}`}
                >
                  {term}
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
