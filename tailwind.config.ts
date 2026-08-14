import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: { DEFAULT: '#02040a', 900: '#03060e', 800: '#060b18' },
        navy: { 900: '#07142a', 800: '#0a1c38', 700: '#0f2a4d', 600: '#163a66' },
        holo: {
          glow: '#3ff0ff',
          bright: '#22d9f5',
          core: '#0ea5c9',
          deep: '#075f77',
          teal: '#2ef2c4',
        },
        alert: {
          amber: '#ffb020',
          crimson: '#ff4d5e',
          green: '#2bff88',
        },
        // Light operations palette, used by the bunching simulator surface.
        // Namespaced `sim` so it cannot collide with the dashboard's dark HUD
        // tokens above; every ink/accent value clears 4.5:1 against white.
        sim: {
          page: '#ffffff',
          surface: '#ffffff',
          well: '#f5f8fb',
          line: '#dde5ee',
          'line-strong': '#c3d0de',
          // ink 15.9:1, muted 5.9:1, faint 4.6:1 against white — the tertiary
          // tier still has to clear AA because it labels which headway is which.
          ink: '#0b2233',
          muted: '#526677',
          faint: '#5b6e7e',
          accent: '#0b6e87',
          teal: '#0a7a63',
          amber: '#8a5200',
          crimson: '#b3172f',
          green: '#0b6b40',
        },
        // Operations console palette (/ops/*). NOT a new look: the ground,
        // the cyan instrument accent and the alert hues are the command
        // centre's own (`void` / `holo` / `alert` above), and `ops.*` only
        // adds the named tiers the HUD never needed because it had no long
        // forms, no tables and no multi-page navigation.
        //
        // The reason these are tokens rather than the literal hexes the ops
        // pages used to inline (#e6e9ef, #9aa0ad, #6f7684, rgba(255,255,255,
        // 0.08)): four dashboards are being built on this surface by four
        // different hands, and an un-named grey is how four dashboards end up
        // with four greys. Every value below clears WCAG AA (4.5:1) against
        // both `ops.bg` and `ops.surface` — `faint`, the weakest, is 6.0:1 on
        // a panel, because the tertiary tier still labels which reading is
        // which.
        ops: {
          bg: '#02040a', // page ground — same void the command centre uses
          surface: '#070f1d', // panel fill — same as .hud-panel
          raised: '#0b1a2e', // nested well inside a panel
          line: '#14304d', // ordinary divider/border
          'line-strong': '#1d4a6e', // emphasised border, focus target
          ink: '#dbeefb', // primary reading text — 16.1:1 on surface
          muted: '#9fb6c9', // secondary/label text — 9.1:1 on surface
          faint: '#7e93a6', // tertiary/annotation text — 6.0:1 on surface
          // Alert hues at TEXT weight. `alert.crimson/amber/green` above are
          // instrument colours — right for a border, a fill or a badge, and
          // thin for a sentence an operator has to read on a dark ground.
          // These are the same three hues lightened to 8.6:1 or better on
          // every ops surface, which is what the twelve pages were already
          // reaching for by hand (#f5a89f, #e8c07a, #7fd9a4).
          danger: '#ff9aa4',
          warn: '#f5c977',
          good: '#8ee7b4',
        },
        // Olympuss landing palette (Section 18). Namespaced so it cannot
        // collide with the dashboard's cyan HUD tokens above.
        ol: {
          bg: '#050507',
          surface: '#0c0d12',
          elevated: '#12141b',
          midnight: '#11182a',
          gold: '#d6a13a',
          'gold-light': '#f3c86a',
          'gold-muted': '#9d7127',
          ivory: '#f2eee7',
          text: '#f2eee7',
          'text-secondary': '#a3a7b2',
          muted: '#707580',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        // Olympuss landing fonts (loaded in the public layout only).
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif-display)', 'ui-serif', 'Georgia', 'serif'],
      },
      boxShadow: {
        hud: '0 0 0 1px rgba(63,240,255,0.18), 0 0 28px -6px rgba(63,240,255,0.35)',
        'hud-strong': '0 0 0 1px rgba(63,240,255,0.35), 0 0 46px -4px rgba(63,240,255,0.5)',
        critical: '0 0 0 1px rgba(255,77,94,0.4), 0 0 40px -6px rgba(255,77,94,0.55)',
        warn: '0 0 0 1px rgba(255,176,32,0.35), 0 0 36px -8px rgba(255,176,32,0.45)',
      },
      backgroundImage: {
        'hud-grid':
          'linear-gradient(rgba(63,240,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(63,240,255,0.055) 1px, transparent 1px)',
        volumetric:
          'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(34,217,245,0.16), transparent 60%), radial-gradient(ellipse 60% 50% at 90% 100%, rgba(46,242,196,0.10), transparent 60%)',
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
      },
    },
  },
  plugins: [],
} satisfies Config;
