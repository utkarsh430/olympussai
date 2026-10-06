export const MAP_UNAVAILABLE_SENTENCE =
  'Basemap unavailable. The depot table and ranked lists below still work.';

export interface MapUnavailableProps {
  readonly onRetry: () => void;
  /** Override for a page whose fallback is not a table and ranked lists. */
  readonly message?: string;
}

/**
 * Flat stand-in for a depot map that could not load: a crimson hairline, one
 * sentence and Retry. It fills the map frame it sits in (the frame is
 * `relative`). No glow, icon or corner ticks, and nothing about keys or script
 * URLs. Shared by every depot map (overview, yard, transfers).
 */
export function MapUnavailable({
  onRetry,
  message = MAP_UNAVAILABLE_SENTENCE,
}: MapUnavailableProps) {
  return (
    <div
      role="alert"
      data-testid="depot-map-unavailable"
      className="absolute inset-0 z-20 flex items-center justify-center bg-depot-surface p-4"
    >
      <div className="max-w-md border-l-2 border-alert-crimson/70 pl-3">
        <p className="font-sans text-sm leading-[1.55] text-depot-ink">{message}</p>
        <button type="button" onClick={onRetry} className="depot-filter-button mt-3">
          Retry
        </button>
      </div>
    </div>
  );
}
