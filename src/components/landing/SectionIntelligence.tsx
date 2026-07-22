import { Reveal } from './Reveal';

const INCOMING = ['Location', 'Movement', 'Language', 'Events', 'Time', 'Patterns', 'Signals'];
const OUTGOING = ['Context', 'Awareness', 'Prediction', 'Coordination', 'Insight', 'Action'];

/**
 * Scene 04 — From Signals to Understanding (Section 25). The fixed WebGL canvas
 * carries the particle convergence; this is the accessible narrative. The tall
 * section + fixed canvas produces the "pinned" transformation without
 * scroll-jacking. Understandable entirely without animation.
 */
export function SectionIntelligence() {
  return (
    <section
      id="intelligence"
      aria-label="From Signals to Understanding"
      className="relative flex min-h-[220vh] flex-col justify-between px-6 py-32"
    >
      <div className="mx-auto w-full max-w-5xl">
        <Reveal>
          <p className="ol-eyebrow">Intelligence in Motion</p>
          <h2 className="ol-display ol-h2 mt-5 max-w-3xl text-ol-ivory">
            From signals to understanding.
          </h2>
          <div className="ol-measure-wide mt-8 space-y-5">
            <p className="ol-body">
              Data begins as movement, language, location, time, and events. Intelligence gives it
              structure—revealing context, relationships, and possibilities that would otherwise
              remain hidden.
            </p>
            <p className="ol-body text-ol-text-secondary/80">
              The future of technology lies not only in collecting information, but in understanding
              what it means.
            </p>
          </div>
        </Reveal>
      </div>

      {/* Incoming signals — cooler, looser. */}
      <div className="mx-auto w-full max-w-5xl">
        <Reveal>
          <p className="ol-eyebrow mb-5 text-ol-text-secondary">Signals</p>
          <ul className="flex flex-wrap gap-x-8 gap-y-3" aria-label="Incoming signals">
            {INCOMING.map((w, i) => (
              <li
                key={w}
                className={`ol-display text-2xl text-ol-text-secondary sm:text-3xl ${i % 2 ? 'opacity-55' : 'opacity-80'}`}
              >
                {w}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>

      {/* The resolving word. */}
      <div className="mx-auto flex w-full max-w-5xl justify-center">
        <Reveal>
          <p
            className="ol-display text-center text-ol-gold-light"
            style={{ fontSize: 'clamp(3rem, 10vw, 8rem)', textShadow: '0 0 60px rgba(214,161,58,0.35)' }}
          >
            Understanding
          </p>
        </Reveal>
      </div>

      {/* Outgoing intelligence — organized, brighter. */}
      <div className="mx-auto w-full max-w-5xl">
        <Reveal>
          <p className="ol-eyebrow mb-5">Understanding</p>
          <ul className="flex flex-wrap gap-x-8 gap-y-3" aria-label="Resulting understanding">
            {OUTGOING.map((w) => (
              <li key={w} className="ol-display text-2xl text-ol-ivory sm:text-3xl">
                {w}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
