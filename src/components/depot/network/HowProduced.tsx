/**
 * The one closed disclosure at the end of a network page: definitions, assumptions and
 * limits that used to sit as paragraphs above the figures. Closed by default; native
 * `<details>`, so it opens in place by keyboard without script.
 */
export function HowProduced({ paragraphs }: { readonly paragraphs: readonly string[] }) {
  return (
    <details className="depot-details mt-10 border-t border-depot-line pt-3" data-testid="depot-how-produced">
      <summary>How these figures are produced</summary>
      <div className="mt-3 max-w-[62ch] space-y-2">
        {paragraphs.map((text) => (
          <p key={text} className="depot-prose text-[13px]">
            {text}
          </p>
        ))}
      </div>
    </details>
  );
}
