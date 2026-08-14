import type { Config } from 'tailwindcss';

/**
 * ─── THE ALIAS LAYER IS THE LOAD-BEARING PART OF THIS FILE ───────────────
 *
 * Four implementers rebuild four dashboards on top of this, in parallel,
 * starting immediately. That only works if every EXISTING page follows the
 * new theme — including light mode — without being edited first. Otherwise
 * step one of the redesign is eighteen broken pages and nobody can start.
 *
 * So the old colour names are not deleted. They are REDEFINED as aliases
 * onto the new CSS variables:
 *
 *     ops.ink   →  hsl(var(--foreground))
 *     ops.line  →  hsl(var(--border))
 *     holo.glow →  hsl(var(--primary))
 *     …
 *
 * `text-ops-ink` on a page nobody has touched now resolves to the themed
 * foreground and follows light and dark correctly. Eighteen pages became
 * theme-aware with no edit to any of them.
 *
 * These aliases are a MIGRATION SURFACE, not the vocabulary. New work uses
 * the semantic names (`text-foreground`, `border-border`, `bg-card`). Each
 * lane deletes the alias uses in the screens it owns, and the final deletion
 * PR removes the aliases themselves. Do not add new uses of them.
 *
 * ─── WHAT IS DELIBERATELY *NOT* ALIASED ──────────────────────────────────
 *
 * `void`, `navy`, `sim` and `ol` stay literal hexes. They belong to the
 * cinematic and simulator surfaces, which are dark-only and light-only
 * respectively and render identically before and after this change. Lane 4
 * owns unifying them. Aliasing them here would have changed three surfaces
 * this foundation is not responsible for and could not verify.
 *
 * ─── DARK MODE IS CLASS-BASED, AND THAT IS WHY SUBTREES CAN OPT OUT ──────
 *
 * `darkMode: 'class'` resolves against a `.dark` ANCESTOR, not just <html>.
 * The cinematic route groups wrap themselves in `<div class="dark">`, which
 * re-declares the token block for that subtree, so /project/* keeps its
 * night look while an operator has the console in light mode. Same mechanism,
 * no second palette.
 */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── THE VOCABULARY ────────────────────────────────────────────────
           shadcn/ui's token names. New work uses these and nothing else. */
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        /* Third text tier. Named `subtle` rather than folded into `muted`
           because `muted` is already a BACKGROUND in shadcn's vocabulary and
           a two-meaning token is how a palette rots. */
        subtle: 'hsl(var(--subtle))',
        /* Alert hues at instrument weight — fills, dots, chip borders, map
           marks. Never the only encoding of a state; see tokens.css. */
        instrument: {
          success: 'hsl(var(--instrument-success))',
          warning: 'hsl(var(--instrument-warning))',
          danger: 'hsl(var(--instrument-danger))',
          info: 'hsl(var(--instrument-info))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        /* ── THE IDENTITY ACCENT ──────────────────────────────────────────
           Olympuss gold, and the ONLY accent that is allowed to be gold.
           `primary` reports measurements; `brand` says whose product this
           is. The landing page, the front door and the project chrome
           inside the command centre wear this; nothing that states a
           reading ever does. See the long note in globals.css for why the
           two themes carry different luminances of one hue. */
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
        },

        /* ── MIGRATION ALIASES — DO NOT ADD NEW USES ──────────────────────
           Every name below already appears across the eighteen ops pages.
           Pointed at the new variables so those pages theme correctly today
           and can be migrated one lane at a time. */
        ops: {
          bg: 'hsl(var(--background))',
          surface: 'hsl(var(--card))',
          raised: 'hsl(var(--muted))',
          line: 'hsl(var(--border))',
          'line-strong': 'hsl(var(--input))',
          ink: 'hsl(var(--foreground))',
          muted: 'hsl(var(--muted-foreground))',
          faint: 'hsl(var(--subtle))',
          danger: 'hsl(var(--destructive))',
          warn: 'hsl(var(--warning))',
          good: 'hsl(var(--success))',
        },
        holo: {
          glow: 'hsl(var(--primary))',
          bright: 'hsl(var(--primary))',
          core: 'hsl(var(--primary))',
          deep: 'hsl(var(--input))',
          teal: 'hsl(var(--instrument-success))',
        },
        alert: {
          green: 'hsl(var(--instrument-success))',
          amber: 'hsl(var(--instrument-warning))',
          crimson: 'hsl(var(--instrument-danger))',
        },

        /* ── THE LAST TWO LITERAL PALETTES ARE NOW ALIASES TOO ────────────
           The foundation left `void`, `navy`, `sim` and `ol` as literal
           hexes because it did not own the surfaces that used them. This
           lane owns them, so:

             `sim` and `ol` are DELETED. `sim` was the old light simulator
             palette, and the simulator now renders on the ops shell, so its
             only remaining users were two dead `light` variants. `ol` was
             the landing page's private palette, and every one of its eleven
             names had a token equivalent already sitting in globals.css —
             keeping it would have been a second vocabulary for the same
             eleven decisions.

             `void` and `navy` survive as ALIASES rather than deletions, for
             the same reason the foundation kept `ops-*`: ~50 uses across the
             command centre, and a migration that has to land in one commit
             to be verifiable is a migration that lands broken. They now
             follow the theme, so the command centre themes without every
             one of those call sites being edited first. Same migration
             surface, same rule — do not add new uses. */
        void: {
          DEFAULT: 'hsl(var(--background))',
          900: 'hsl(var(--background))',
          800: 'hsl(var(--card))',
        },
        navy: {
          900: 'hsl(var(--card))',
          800: 'hsl(var(--popover))',
          700: 'hsl(var(--border))',
          600: 'hsl(var(--input))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        /* One body family carrying English and Hindi with identical vertical
           metrics. See src/app/fonts.ts for the measurements. */
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        /* Migration aliases. Orbitron and the landing serif are retired;
           these point at the body face so no surface loses its font — and,
           more importantly, so no bilingual string lands on a face with no
           Devanagari in it. */
        display: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      lineHeight: {
        /* Devanagari ink spans 1.164em against Latin's 1.005em, so a line
           height that is comfortable for English lets matras collide in
           Hindi. Any element that can hold Devanagari uses `leading-hindi`. */
        hindi: '1.75',
      },
      boxShadow: {
        /* NOTE: there is no `shadow-xs` in Tailwind 3.4.19 (the scale is
           sm/DEFAULT/md/lg/xl/2xl/inner/none). shadcn's `new-york-v4`
           registry emits `shadow-xs`, which compiles to nothing, renders
           flat and never errors. This project uses the `new-york` (v3)
           registry style for exactly that reason. */
        panel: '0 10px 30px -24px rgb(0 0 0 / 0.9)',
        'panel-raised': '0 18px 50px -22px rgb(0 0 0 / 0.9)',
        /* Bloom shadows, scaled by `--hud-bloom` so they read as glow on the
           night ground and as a plain hairline on the day one. */
        hud: '0 0 0 1px rgb(var(--hud-glow-rgb) / calc(0.18 * var(--hud-bloom))), 0 0 28px -6px rgb(var(--hud-glow-rgb) / calc(0.35 * var(--hud-bloom)))',
        'hud-strong':
          '0 0 0 1px rgb(var(--hud-glow-rgb) / calc(0.35 * var(--hud-bloom))), 0 0 46px -4px rgb(var(--hud-glow-rgb) / calc(0.5 * var(--hud-bloom)))',
        critical:
          '0 0 0 1px hsl(var(--instrument-danger) / 0.4), 0 0 40px -6px hsl(var(--instrument-danger) / calc(0.55 * var(--hud-bloom)))',
        warn: '0 0 0 1px hsl(var(--instrument-warning) / 0.35), 0 0 36px -8px hsl(var(--instrument-warning) / calc(0.45 * var(--hud-bloom)))',
        /* The landing page's card lift. Warm rather than neutral, because the
           identity accent is warm and a cool shadow under a gold card reads
           as a printing error. */
        brand: '0 24px 60px -32px hsl(var(--brand) / 0.55)',
      },
      backgroundImage: {
        'hud-grid':
          'linear-gradient(rgb(var(--hud-glow-rgb) / calc(0.055 * var(--hud-bloom))) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--hud-glow-rgb) / calc(0.055 * var(--hud-bloom))) 1px, transparent 1px)',
        volumetric:
          'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(var(--primary) / calc(0.16 * var(--hud-bloom))), transparent 60%), radial-gradient(ellipse 60% 50% at 90% 100%, hsl(var(--instrument-success) / calc(0.10 * var(--hud-bloom))), transparent 60%)',
        /* The landing's ambient field, defined once here so the backdrop
           component carries no colour of its own. */
        stage:
          'radial-gradient(circle at 50% 38%, var(--stage-core), transparent 62%), radial-gradient(ellipse 70% 60% at 70% 100%, var(--stage-depth), transparent 70%)',
      },
      backgroundSize: { 'hud-grid': '44px 44px' },
      keyframes: {
        'scan-y': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '10%,90%': { opacity: '1' },
          '100%': { transform: 'translateY(1000%)', opacity: '0' },
        },
        'radar-sweep': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.7)', opacity: '0.85' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        'core-breathe': {
          '0%,100%': { transform: 'scale(1)', opacity: '0.9' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
        'data-stream': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '0 -220px' },
        },
        orbit: { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(-360deg)' } },
        flicker: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.72' } },
        rise: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        drift: {
          '0%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(6px,-10px,0)' },
          '100%': { transform: 'translate3d(0,0,0)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'scan-y': 'scan-y 5.5s linear infinite',
        'radar-sweep': 'radar-sweep 3.6s linear infinite',
        'pulse-ring': 'pulse-ring 2.4s ease-out infinite',
        'core-breathe': 'core-breathe 3.4s ease-in-out infinite',
        'data-stream': 'data-stream 9s linear infinite',
        orbit: 'orbit 18s linear infinite',
        flicker: 'flicker 2.6s ease-in-out infinite',
        rise: 'rise 0.4s ease-out both',
        drift: 'drift 7s ease-in-out infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
