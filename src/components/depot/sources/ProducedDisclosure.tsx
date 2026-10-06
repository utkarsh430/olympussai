/**
 * The page's one closed disclosure at the end, "How these figures are produced":
 * definitions, assumptions and limits that used to sit as paragraphs above the
 * content. A native `details`, so keyboard and screen readers behave natively.
 */
export function ProducedDisclosure({ children }: { readonly children: React.ReactNode }) {
  return (
    <details className="group mt-8 border-t border-depot-line pt-3" data-testid="depot-produced">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block w-3 text-depot-faint group-open:rotate-90">
          ›
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-depot-faint">
          How these figures are produced
        </span>
      </summary>
      <div className="depot-prose mt-2 flex max-w-[62ch] flex-col gap-2">{children}</div>
    </details>
  );
}
