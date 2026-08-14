/**
 * "OLYMPUSS AI" wordmark — HTML text rather than an image, so it scales, is
 * searchable, and is read aloud correctly.
 *
 * `font-serif` is gone: it aliased to the body face anyway once the editorial
 * serif was retired, so it was a name pointing at nothing. The weight and the
 * tight tracking are what actually carry the mark.
 *
 * OLYMPUSS takes the foreground tier and AI takes the identity accent, both
 * from tokens, so the mark reads correctly on the night ground and on the day
 * one. It used to be pinned to ivory-on-gold, which was invisible the moment
 * this surface stopped being dark-only.
 */
export function OlympussWordmark({ className }: { className?: string }) {
  return (
    <span className={`font-light tracking-tight ${className ?? ''}`}>
      <span className="text-foreground">OLYMPUSS</span>
      <span className="text-brand">&nbsp;AI</span>
    </span>
  );
}
