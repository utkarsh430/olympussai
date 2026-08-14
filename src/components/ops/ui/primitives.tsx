/**
 * The operations console's shared visual vocabulary.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * /project/* looks good and /ops/* did not, and the difference was never
 * talent — it was that /project/* had a design language written down
 * (`hud-*` in globals.css, the `holo`/`alert` tokens in tailwind.config.ts)
 * and /ops/* had twelve pages each inlining `#6f7684` and
 * `rgba(255,255,255,0.08)` from memory. Four dashboards are now being built
 * on this surface by four different hands. Without a named vocabulary that
 * produces four dashboards, not one console.
 *
 * So: this module is that vocabulary, and it is LIFTED, not invented. Every
 * class it emits resolves to the command centre's own tokens. See
 * `.ops-*` in src/app/globals.css for the one place a value is chosen, and
 * the `ops` colour block in tailwind.config.ts for why the greys are named.
 *
 * ─── HOW TO USE IT ───────────────────────────────────────────────────────
 *
 * Compose, do not restyle. If a dashboard needs a surface, that is
 * `OpsPanel`; a titled block of a page is `OpsSection`; a number an operator
 * reads at a glance is `OpsStat`. Reach for a raw `className` with a colour
 * in it only when this module genuinely has no answer — and when that
 * happens the fix is to add the primitive here, so the next dashboard
 * inherits it.
 *
 * ─── SERVER-COMPONENT SAFE ───────────────────────────────────────────────
 *
 * Deliberately no `'use client'` and no hooks. Most ops dashboards render on
 * the server (the fleet table is thousands of rows — shipping it as client
 * JS would be a real cost), so these have to be renderable there. A client
 * component importing them still works: the module compiles into whichever
 * graph imports it.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ─────────────────────────────────────────────────────────────────────────
   SURFACES
   ───────────────────────────────────────────────────────────────────────── */

/**
 * A framed surface. The ops equivalent of `.hud-panel`, minus the outer
 * bloom (see globals.css for why).
 *
 * `title` renders an `<h3>`, deliberately: `OpsShell` owns the page's only
 * `<h1>` and `OpsSection` owns `<h2>`, so a panel nested in a section lands
 * at the right depth without any caller thinking about heading levels. Pass
 * `headingLevel` when a panel is used at the top level of a page instead.
 */
export function OpsPanel({
  title,
  description,
  actions,
  headingLevel = 3,
  tone = 'default',
  padded = true,
  className,
  bodyClassName,
  children,
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  tone?: 'default' | 'accent';
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'children'>) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const hasHeader = Boolean(title || actions || description);

  return (
    <section
      className={cn(tone === 'accent' ? 'ops-panel-accent' : 'ops-panel', className)}
      {...rest}
    >
      {hasHeader && (
        <header
          className={cn(
            'flex flex-wrap items-start justify-between gap-3 border-b border-ops-line px-4 py-3',
          )}
        >
          <div className="min-w-0">
            {title ? <Heading className="ops-label">{title}</Heading> : null}
            {description ? (
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-ops-faint">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={cn(padded && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * A titled block of a page — the pattern every ops dashboard was already
 * hand-rolling, in each of twelve files, as a bare `<section>` wrapping an
 * `<h2>` with a hand-copied mono/uppercase/grey class string.
 *
 * Renders `<h2>`, one level below the shell's `<h1>`. That is the whole
 * reason to prefer it over a bare `<section>`: it keeps the twelve pages'
 * heading outlines consistent for a screen-reader operator, which they were
 * not.
 */
export function OpsSection({
  title,
  description,
  actions,
  className,
  children,
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'children'>) {
  return (
    <section className={cn('min-w-0', className)} {...rest}>
      {(title || actions || description) && (
        <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="ops-label">{title}</h2> : null}
            {description ? (
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-ops-faint">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

/** Standard vertical rhythm for a dashboard body. One spacing, twelve pages. */
export function OpsStack({
  children,
  gap = 'normal',
  className,
}: {
  children?: ReactNode;
  gap?: 'tight' | 'normal' | 'loose';
  className?: string;
}) {
  return (
    <div
      className={cn(
        gap === 'tight' ? 'space-y-4' : gap === 'loose' ? 'space-y-10' : 'space-y-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Responsive column grid for panels. Collapses to one column on a depot
 * tablet held in portrait, which is a real device on this surface.
 */
export function OpsGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 2 | 3 | 4;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-4',
        columns === 2 && 'md:grid-cols-2',
        columns === 3 && 'md:grid-cols-2 xl:grid-cols-3',
        columns === 4 && 'sm:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   READOUTS
   ───────────────────────────────────────────────────────────────────────── */

export type OpsTone = 'default' | 'accent' | 'good' | 'warn' | 'critical';

const TONE_TEXT: Record<OpsTone, string> = {
  default: 'text-ops-ink',
  accent: 'text-holo-glow',
  good: 'text-alert-green',
  warn: 'text-alert-amber',
  critical: 'text-alert-crimson',
};

/**
 * One number an operator reads at a glance. Tabular figures are not a
 * flourish here: a headway column whose digits change width jitters on every
 * poll, and a jittering number is one an operator stops trusting.
 */
export function OpsStat({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: OpsTone;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 leading-tight', className)}>
      <div className="ops-eyebrow truncate">{label}</div>
      <div className={cn('mt-1 font-mono text-lg tabular-nums', TONE_TEXT[tone])}>
        {value}
        {unit ? <span className="ml-1 text-xs text-ops-faint">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-ops-faint">{hint}</div> : null}
    </div>
  );
}

/**
 * The horizontal band of numbers that sits directly under the shell chrome.
 * Pass this to `OpsShell`'s `statusStrip` slot rather than rendering it in
 * the page body — the slot is pinned above the scroll region, so the numbers
 * stay on screen while an operator scrolls a long incident list.
 */
export function OpsStatStrip({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  // Separated by space rather than by hairline rules. Rules were tried and
  // removed: a `:not(:first-child)` divider indents whichever stat happens to
  // wrap onto a second row, so on a depot tablet the strip visibly lost its
  // left alignment. Spacing survives every width.
  return (
    <div className={cn('flex flex-wrap items-start gap-x-10 gap-y-3 px-6 py-3', className)}>
      {children}
    </div>
  );
}

/** Small key/value pair for a panel body. */
export function OpsReadout({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: OpsTone;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="ops-eyebrow truncate">{label}</div>
      <div className={cn('truncate font-mono text-sm tabular-nums', TONE_TEXT[tone])}>{value}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   STATUS AND PROVENANCE
   ───────────────────────────────────────────────────────────────────────── */

export type OpsBadgeVariant = 'live' | 'sim' | 'fixture' | 'critical' | 'neutral';

/**
 * The provenance/status chip. `live` / `sim` / `fixture` / `critical` reuse
 * the command centre's own `.badge-*` classes verbatim, and that is
 * load-bearing rather than tidy: this product's central honesty claim is
 * that an operator can always tell observed data from modelled data, and it
 * only holds if the same source value looks the same on every surface. Do
 * not introduce a second green chip.
 */
export function OpsBadge({
  variant = 'neutral',
  children,
  className,
  dot = true,
}: {
  variant?: OpsBadgeVariant;
  children?: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const variantClass =
    variant === 'live'
      ? 'badge-live'
      : variant === 'fixture'
        ? 'badge-fixture'
        : variant === 'critical'
          ? 'badge-critical'
          : variant === 'sim'
            ? 'badge-sim'
            : 'inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-ops-line-strong bg-ops-raised px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ops-muted';

  const dotClass =
    variant === 'live'
      ? 'bg-alert-green'
      : variant === 'fixture'
        ? 'bg-holo-glow'
        : variant === 'critical'
          ? 'bg-alert-crimson'
          : variant === 'sim'
            ? 'bg-alert-amber'
            : 'bg-ops-faint';

  return (
    <span className={cn(variantClass, className)}>
      {dot ? <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dotClass)} /> : null}
      {children}
    </span>
  );
}

export type OpsAlertTone = 'info' | 'success' | 'warning' | 'error';

const ALERT_CLASS: Record<OpsAlertTone, string> = {
  info: 'border-holo-glow/35 bg-holo-glow/[0.07] text-ops-ink',
  success: 'border-alert-green/40 bg-alert-green/10 text-alert-green',
  warning: 'border-alert-amber/40 bg-alert-amber/10 text-alert-amber',
  error: 'border-alert-crimson/45 bg-alert-crimson/10 text-ops-danger',
};

/**
 * An inline message about the state of the surface, not of a form field.
 *
 * `warning` and `error` announce as `role="alert"` and the quieter tones as
 * `role="status"`, which is the distinction that matters on a console: an
 * operator on shift must be interrupted by "the feed is down" and must not
 * be interrupted by "12 vehicles shown".
 *
 * Twelve pages currently repeat this markup inline as a red `<p>`; that is
 * exactly the duplication this replaces.
 */
export function OpsAlert({
  tone = 'info',
  title,
  children,
  className,
  ...rest
}: {
  tone?: OpsAlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'children'>) {
  const assertive = tone === 'warning' || tone === 'error';
  return (
    <div
      role={assertive ? 'alert' : 'status'}
      data-tone={tone}
      className={cn('rounded-md border px-4 py-3 text-sm', ALERT_CLASS[tone], className)}
      {...rest}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

/**
 * What a table or list says when it has nothing in it. Always take a
 * caller-supplied label: "no vehicles reporting" is reassuring on a quiet
 * night and dangerously wrong during an outage, and only the caller knows
 * which one it is (see DataSourceNotice's `emptyFleetLabel`).
 */
export function OpsEmptyState({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('ops-well px-4 py-6 text-center text-sm text-ops-muted', className)}>
      {children}
    </p>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   CONTROLS
   ───────────────────────────────────────────────────────────────────────── */

export type OpsButtonVariant = 'default' | 'primary' | 'danger' | 'quiet';

export function opsButtonClass(variant: OpsButtonVariant = 'default', className?: string): string {
  return cn(
    variant === 'primary'
      ? 'ops-button-primary'
      : variant === 'danger'
        ? 'ops-button-danger'
        : variant === 'quiet'
          ? 'ops-button-quiet'
          : 'ops-button',
    className,
  );
}

export function OpsButton({
  variant = 'default',
  className,
  type = 'button',
  ...rest
}: { variant?: OpsButtonVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={opsButtonClass(variant, className)} {...rest} />;
}

/**
 * A field wrapper: label, optional hint, optional error, wired together.
 *
 * The caller supplies both `htmlFor` and the control's own `id` — this
 * deliberately does not clone children to inject one. A silently-injected id
 * is the kind of magic that makes a label quietly stop pointing at anything
 * the first time somebody wraps the control in a div.
 */
export function OpsField({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="ops-label mb-1.5 block">
        {label}
        {required ? (
          <span className="ml-1 text-alert-crimson" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="mt-1 text-[11px] leading-snug text-ops-faint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-[11px] leading-snug text-ops-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function OpsInput({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('ops-input', className)} {...rest} />;
}

export function OpsSelect({
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('ops-input', className)} {...rest} />;
}

export function OpsTextarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('ops-input', 'min-h-24 resize-y', className)} {...rest} />;
}

/** A row of controls above a table or panel body. */
export function OpsToolbar({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end gap-3', className)}>{children}</div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   TABLES
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Table class constants rather than a `<OpsTable columns rows>` component,
 * on purpose. Ops tables differ in every way that matters — a cell is a
 * badge here, a countdown there, a link somewhere else — and a
 * data-driven table component either grows a prop for each of those or gets
 * abandoned. Constants give every table the same frame, header treatment and
 * row rhythm while leaving the cells entirely to the dashboard.
 *
 * `OpsTableFrame` is the one piece worth wrapping: it carries the horizontal
 * scroll container, without which a wide fleet table blows out the page on a
 * depot tablet.
 */
export const opsTableClass = 'w-full text-left text-sm';
export const opsTheadRowClass =
  'border-b border-ops-line text-[11px] uppercase tracking-[0.12em] text-ops-muted';
export const opsThClass = 'px-3 py-2 font-mono font-normal';
export const opsTrClass = 'border-b border-ops-line/60 text-ops-ink last:border-0';
export const opsTdClass = 'px-3 py-2';
/** Secondary cell — the reading is real but is not what the row is about. */
export const opsTdMutedClass = 'px-3 py-2 text-ops-muted';
/** Any cell holding a number that updates. See OpsStat on why tabular. */
export const opsTdNumericClass = 'px-3 py-2 font-mono tabular-nums';

export function OpsTableFrame({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-ops-line', className)}>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   MAP
   ───────────────────────────────────────────────────────────────────────── */

/**
 * The frame a map goes in.
 *
 * Two things it exists to guarantee, both learned the hard way on
 * /project/upsrtc:
 *
 *   1. A DEFINITE HEIGHT. Google Maps sizes itself to its container; a
 *      container that is `h-full` inside an `auto`-height ancestor resolves
 *      to zero and the map renders as a blank strip. This sets an explicit
 *      minimum and expects to sit inside `OpsShell variant="full"`, whose
 *      main pane is a real flex child with `min-h-0`.
 *   2. NO TRANSFORM SCALING ON ANY ANCESTOR. The fleet canvas overlay
 *      projects vehicle positions in layout pixels, so a `transform: scale`
 *      above it slides every bus off the road (the command-centre layout
 *      comments on this at length — it uses `zoom` for exactly that reason).
 *      Nothing here scales, and nothing wrapping it should.
 *
 * `overlay` renders above the map, inside the frame, with pointer events off
 * by default so it cannot eat a drag on the basemap; give an interactive
 * child `pointer-events-auto`.
 */
export function OpsMapFrame({
  children,
  overlay,
  className,
  minHeight = '28rem',
}: {
  children?: ReactNode;
  overlay?: ReactNode;
  className?: string;
  minHeight?: string;
}) {
  return (
    <div
      className={cn(
        'relative isolate h-full w-full overflow-hidden rounded-lg border border-holo-glow/25 bg-ops-bg',
        className,
      )}
      style={{ minHeight }}
    >
      {children}
      {overlay ? (
        <div className="pointer-events-none absolute inset-0 z-10">{overlay}</div>
      ) : null}
    </div>
  );
}
