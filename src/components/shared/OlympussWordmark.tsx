/**
 * "OLYMPUSS AI" wordmark — HTML text (Section 17): OLYMPUSS in warm ivory, AI in
 * gold. Rendered in the editorial serif for strong dark-background readability.
 */
export function OlympussWordmark({ className }: { className?: string }) {
  return (
    <span className={`font-serif tracking-tight ${className ?? ''}`}>
      <span className="text-ol-ivory">OLYMPUSS</span>
      <span className="text-ol-gold">&nbsp;AI</span>
    </span>
  );
}
