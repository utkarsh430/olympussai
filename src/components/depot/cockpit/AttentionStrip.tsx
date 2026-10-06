import Link from 'next/link';
import type { Attention } from '@/lib/depot/cockpit/attention';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';

/**
 * The cockpit's hero: what needs attention now, most pressing first, each line a
 * link to the list that holds those buses, ending in where it lands; two columns of
 * three from 1024 px (an odd strip's empty last cell keeps its rule). Under 640 px a line
 * wraps to a second line rather than cutting its words. One compact nil line when nothing needs attention.
 */
export function AttentionStrip({ attention }: { readonly attention: Attention }) {
  return (
    <section aria-labelledby="depot-attention" data-testid="depot-attention" className="min-w-0">
      <h2 id="depot-attention" className="sr-only">
        Needs attention
      </h2>
      {attention.calm !== null ? (
        <StatePanel kind="empty" compact tone="ok" sentence={attention.calm} />
      ) : (
        <ul className="grid min-w-0 border-t border-depot-line lg:grid-cols-2 lg:gap-x-8">
          {attention.lines.map((line) => (
            <li key={line.key} className="min-w-0 border-b border-depot-line">
              <Link
                href={line.href}
                data-testid={`depot-attention-${line.key}`}
                className="group flex min-w-0 items-baseline gap-4 py-2 hover:bg-depot-surface focus-visible:bg-depot-surface"
              >
                <span className="w-14 shrink-0 text-right font-display text-[24px] leading-none tabular-nums text-depot-ink">
                  {formatCount(line.count)}
                </span>
                <span className="min-w-0 flex-1 font-sans text-sm text-depot-ink group-hover:underline sm:truncate" title={line.text}>
                  {line.text.replace(/^[\d,]+ /, '')}
                </span>
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted">
                  {line.destination}
                  <span aria-hidden> ›</span>
                </span>
              </Link>
            </li>
          ))}
          {attention.lines.length % 2 === 1 ? (
            // The empty last cell of an odd strip keeps its bottom rule, so 3+2 ends on one line.
            <li aria-hidden data-testid="depot-attention-filler" className="hidden border-b border-depot-line lg:block" />
          ) : null}
        </ul>
      )}
    </section>
  );
}
