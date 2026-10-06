const KEY: readonly { readonly word: string; readonly swatch: string; readonly means: string }[] = [
  {
    word: 'Solid bar',
    swatch: 'border-solid border-holo-glow bg-holo-glow/30',
    means: 'matched: the registration of the proposed bus is beside it',
  },
  {
    word: 'Dashed outline',
    swatch: 'border-dashed border-alert-crimson',
    means: 'unmatched: no bus proposed (why is stated above the chart)',
  },
];

/** What the bar styles mean, in words; the swatches only repeat it. */
export function DutyLegend() {
  return (
    <ul
      aria-label="Legend"
      className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-depot-muted"
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
          <span className="text-depot-ink">Now</span>: the feed clock, Indian time
        </span>
      </li>
      <li>A square end runs past the 04:00 to 24:00 axis.</li>
    </ul>
  );
}
