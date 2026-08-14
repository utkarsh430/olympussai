/**
 * The landing page's ambient field.
 *
 * A fixed, pure-CSS wash with a warm brand core and a cooler depth pool
 * beneath it. It renders instantly (no JS, no WebGL) and is the guaranteed
 * base layer: the WebGL globe mounts on top when the ground is dark enough to
 * carry it, and when it does not — light theme, reduced motion, or no WebGL —
 * this remains as an intentional static edition rather than a blank page.
 *
 * ─── IT NO LONGER OWNS ANY COLOUR ────────────────────────────────────────
 *
 * The three gradients used to be literal rgba: gold at 0.14 over #050507,
 * with a midnight pool at 0.5. Those exact values are still what renders on
 * the night ground — they are now `--stage-core`, `--stage-depth` and
 * `--stage-grain` in the dark token block, unchanged to the last digit. The
 * light block carries the same composition at day luminance: the same warm
 * core over the same cool pool, both far weaker, because a 0.5 midnight wash
 * on a light page is a bruise rather than depth.
 *
 * The grain is the one piece that genuinely changes character. `mix-blend-
 * screen` lightens whatever is under it, which is invisible on white — so it
 * switches to `multiply` on the light ground, where darkening is what texture
 * means. Same grain, same weight, opposite direction, because the ground
 * flipped.
 */
export function LandingBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-background">
      {/* Core wash + depth pool, composed once in tailwind.config as
          `bg-stage` so this component states no colour at all. */}
      <div className="absolute inset-0 bg-stage" />

      {/* Fine grain, generated inline (no asset fetch). */}
      <div
        className="absolute inset-0 mix-blend-multiply dark:mix-blend-screen"
        style={{
          opacity: 'var(--stage-grain)',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
