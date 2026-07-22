/**
 * Procedural Olympuss mark — a scalable SVG motif derived from the brand logo
 * (golden halo ring, radial rays, ascending twin-peak). Pure vector, no asset
 * dependency, so it renders instantly and is the guaranteed static fallback
 * when WebGL or raster assets are unavailable (Section 32).
 *
 * The exact photographic logo + wordmark are used in raster contexts (favicon,
 * OG image, touch icon) and where a literal treatment is wanted.
 */
export function OlympussMark({
  className,
  title,
  rays = true,
}: {
  className?: string;
  title?: string;
  rays?: boolean;
}) {
  // 48 evenly spaced rays of alternating length, matching the logo's sunburst.
  const rayCount = 48;
  const rayNodes = rays
    ? Array.from({ length: rayCount }, (_, i) => {
        const angle = (i / rayCount) * Math.PI * 2;
        const long = i % 2 === 0;
        const inner = 62;
        const outer = long ? 96 : 84;
        const x1 = 100 + Math.cos(angle) * inner;
        const y1 = 100 + Math.sin(angle) * inner;
        const x2 = 100 + Math.cos(angle) * outer;
        const y2 = 100 + Math.sin(angle) * outer;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="url(#ol-gold)"
            strokeWidth={long ? 1.1 : 0.8}
            strokeLinecap="round"
            opacity={long ? 0.85 : 0.5}
          />
        );
      })
    : null;

  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id="ol-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3c86a" />
          <stop offset="0.5" stopColor="#d6a13a" />
          <stop offset="1" stopColor="#9d7127" />
        </linearGradient>
      </defs>
      {rayNodes}
      {/* Halo ring */}
      <circle cx="100" cy="100" r="54" fill="none" stroke="url(#ol-gold)" strokeWidth="4" />
      <circle cx="100" cy="100" r="54" fill="none" stroke="#f3c86a" strokeWidth="0.6" opacity="0.5" />
      {/* Ascending twin-peak */}
      <path
        d="M64 138 L92 92 L100 104 L108 92 L136 138"
        fill="none"
        stroke="url(#ol-gold)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M84 138 L100 112 L116 138"
        fill="none"
        stroke="url(#ol-gold)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  );
}
