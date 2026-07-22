import { Reveal } from './Reveal';
import { ExplorationConcepts } from './ExplorationConcepts';

/**
 * Scene 03 — Fields of Exploration (Section 24). Five orbiting concepts around
 * the intelligence core; the interaction and full descriptions live in
 * accessible HTML (ExplorationConcepts). These are fields of exploration — never
 * products, services or commercial offerings.
 */
export function SectionExploration() {
  return (
    <section
      id="exploration"
      aria-label="Fields of Exploration"
      className="relative flex min-h-[185vh] flex-col justify-center px-6 py-32"
    >
      <div className="mx-auto w-full max-w-6xl">
        <Reveal>
          <p className="ol-eyebrow">Fields of Exploration</p>
          <h2 className="ol-display ol-h2 mt-5 max-w-3xl text-ol-ivory">
            The evolving landscape of intelligence.
          </h2>
          <p className="ol-body ol-measure-wide mt-7">
            Ideas, systems, and technologies shaping how machines understand and interact with the
            world.
          </p>
        </Reveal>

        <ExplorationConcepts />
      </div>
    </section>
  );
}
