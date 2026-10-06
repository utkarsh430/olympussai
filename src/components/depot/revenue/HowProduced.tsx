import Link from 'next/link';

const SOURCES_PATH = '/project/depots/sources';

/**
 * The closed end-of-page disclosure ("How these figures are produced") that carries
 * what a modelled page used to say in its closing panel: what is modelled, the
 * definitions, the assumptions, the price used and the feeds that would replace the
 * model. Native `<details>`: the summary has a real expanded state for assistive tech.
 */
export function HowProduced({ paragraphs }: { readonly paragraphs: readonly string[] }) {
  return (
    <details
      className="group min-w-0 border-t border-depot-line pt-3"
      data-testid="depot-how-produced"
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-depot-muted hover:text-depot-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block w-3 text-depot-faint group-open:rotate-90">
          ›
        </span>
        How these figures are produced
      </summary>
      <div className="mt-2 flex max-w-3xl flex-col gap-2">
        {paragraphs.map((paragraph) => (
          <p key={paragraph} className="depot-prose">
            {paragraph}
          </p>
        ))}
        <p className="depot-prose">
          The fields each feed must provide are listed on the{' '}
          <Link href={SOURCES_PATH} className="depot-link">
            Data sources page
          </Link>
          .
        </p>
      </div>
    </details>
  );
}
