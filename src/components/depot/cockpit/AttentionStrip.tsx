import Link from 'next/link';
import type { Attention } from '@/lib/depot/cockpit/attention';
import { formatCount } from '@/lib/depot/format';

/**
 * The cockpit's hero: what needs attention now, most pressing first, each line a
 * link to the list that holds those buses; one calm line when nothing does.
 */
export function AttentionStrip({ attention }: { readonly attention: Attention }) {
  return (
    <section aria-labelledby="depot-attention" data-testid="depot-attention" className="min-w-0">
      <h2 id="depot-attention" className="sr-only">
        Needs attention
      </h2>
      {attention.calm !== null ? (
        <p className="border-l-2 border-alert-green py-2 pl-3 font-sans text-sm text-depot-ink">{attention.calm}</p>
      ) : (
        <ul className="min-w-0 border-y border-depot-line">
          {attention.lines.map((line) => (
            <li key={line.key} className="min-w-0 border-b border-depot-line last:border-b-0">
              <Link
                href={line.href}
                data-testid={`depot-attention-${line.key}`}
                className="group flex min-w-0 items-baseline gap-4 py-2 hover:bg-depot-surface focus-visible:bg-depot-surface"
              >
                <span className="w-14 shrink-0 text-right font-display text-[24px] leading-none tabular-nums text-depot-ink">
                  {formatCount(line.count)}
                </span>
                <span className="min-w-0 truncate font-sans text-sm text-depot-ink group-hover:underline" title={line.text}>
                  {line.text.replace(/^[\d,]+ /, '')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
