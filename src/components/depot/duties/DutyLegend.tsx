import { nowLinePct, nowSentence } from '@/lib/depot/duties/dutyBoardModel';

const KEY: readonly { readonly word: string; readonly swatch: string; readonly means: string }[] = [
  {
    word: 'Solid bar',
    swatch: 'border border-solid border-holo-glow bg-holo-glow/30',
    means: 'matched, with the registration of the bus beside it',
  },
  {
    word: 'Thick left edge',
    swatch: 'border border-l-4 border-solid border-holo-glow bg-holo-glow/30',
    means: 'its bus is on the road now; a thin edge, its bus is standing',
  },
  {
    word: 'Dashed outline',
    swatch: 'relative border border-dashed border-depot-muted/60',
    means: 'unmatched, no bus (why is said above the chart)',
  },
];

/**
 * What the bar styles mean, in words, in one wrapping line under the chart; the
 * swatches only repeat them. Without a now line it says why there is none.
 */
export function DutyLegend({ feedNow }: { readonly feedNow: string | null }) {
  const hasNow = nowLinePct(feedNow) !== null;
  return (
    <ul aria-label="Legend" className="depot-note mt-2 flex flex-wrap gap-x-6 gap-y-1">
      {KEY.map((item) => (
        <li key={item.word} className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={`inline-block h-3 w-6 shrink-0 rounded-[2px] ${item.swatch}`}>
            {item.word === 'Dashed outline' ? (
              <span className="absolute inset-y-0 left-0 w-[2px] bg-alert-crimson" />
            ) : null}
          </span>
          <span>
            <span className="text-depot-ink">{item.word}</span>: {item.means}
          </span>
        </li>
      ))}
      {hasNow ? (
        <li className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-[2px] bg-alert-amber" />
          <span>
            <span className="text-depot-ink">Now</span>: the feed clock, Indian time
          </span>
        </li>
      ) : (
        <li data-testid="duty-now-sentence">{nowSentence(feedNow)}</li>
      )}
      <li>A square end runs past the 04:00 to 24:00 axis.</li>
    </ul>
  );
}
