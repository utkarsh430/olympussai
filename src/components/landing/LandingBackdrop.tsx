/**
 * Static atmospheric backdrop (Section 32).
 *
 * A fixed, pure-CSS dark field with a soft gold core glow and midnight depth.
 * It renders instantly (no JS, no WebGL) and is the guaranteed base layer: the
 * WebGL canvas mounts on top when appropriate, and when it does not
 * (reduced-motion / no WebGL) this remains as an intentional static edition.
 */
export function LandingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-ol-bg">
      {/* Core golden glow, upper-centre. */}
      <div
        className="absolute left-1/2 top-[38%] h-[90vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, rgba(214,161,58,0.14), rgba(17,24,42,0.10) 42%, transparent 68%)',
        }}
      />
      {/* Midnight depth, lower field. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[60vh]"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 70% 100%, rgba(17,24,42,0.5), transparent 70%)',
        }}
      />
      {/* Fine grain, generated inline (no asset fetch). */}
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-screen"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
