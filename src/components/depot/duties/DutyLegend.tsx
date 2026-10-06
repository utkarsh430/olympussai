const KEY: readonly { readonly word: string; readonly swatch: string; readonly means: string }[] = [
  {
    word: 'Assigned',
    swatch: 'border-solid border-holo-glow/70 bg-holo-glow/20',
    means: 'the matching proposes this bus',
  },
  {
    word: 'No bus',
    swatch: 'border-dashed border-alert-amber',
    means: 'no free bus of the duty’s class',
  },
  {
    word: 'Bus not in yard',
    swatch: 'border-dotted border-alert-crimson',
    means: 'a bus of its class is held out because it is not in the yard',
  },
];

/** What the bar styles mean. The words carry the meaning; the swatches only repeat it. */
export function DutyLegend() {
  return (
    <ul
      aria-label="Legend"
      className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-depot-muted"
    >
      {KEY.map((item) => (
        <li key={item.word} className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-3 w-6 rounded-[2px] border ${item.swatch}`}
          />
          <span>
            <span className="text-depot-ink">{item.word}</span>: {item.means}
          </span>
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span aria-hidden className="inline-block h-3 w-[2px] bg-alert-amber" />
        <span>
          <span className="text-depot-ink">Now</span>: the feed clock
        </span>
      </li>
      <li>A bar with a square end runs past the edge of the 04:00 to 24:00 axis.</li>
    </ul>
  );
}
