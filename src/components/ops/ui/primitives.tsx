/**
 * The operations console's shared visual vocabulary, on shadcn/ui + Tailwind.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * Four dashboards are being rebuilt on this surface by four different hands,
 * in parallel. Without a named vocabulary that produces four dashboards, not
 * one console. Every class emitted here resolves to a token defined in the
 * one place tokens are defined (`src/app/globals.css`).
 *
 * ─── HOW TO USE IT ───────────────────────────────────────────────────────
 *
 * Compose, do not restyle. A surface is `OpsPanel`; a titled block of a page
 * is `OpsSection`; a number read at a glance is `OpsStat`. Reach for a raw
 * `className` carrying a colour only when this module genuinely has no
 * answer — and when that happens, add the primitive here so the next
 * dashboard inherits it rather than inventing its own.
 *
 * Use the SEMANTIC token names in any new markup: `text-foreground`,
 * `text-muted-foreground`, `text-subtle`, `bg-card`, `border-border`,
 * `border-input`. The `ops-*` colour names still resolve (they are aliases
 * onto the same variables, which is what lets eighteen untouched pages
 * theme correctly today) but they are a migration surface and are being
 * deleted lane by lane. Do not add new uses of them.
 *
 * ─── SERVER-COMPONENT SAFE ───────────────────────────────────────────────
 *
 * Deliberately no `'use client'` and no hooks, and every shadcn primitive it
 * imports is server-safe too. Most ops dashboards render on the server — the
 * fleet table is thousands of rows, and shipping it as client JS would be a
 * real cost — so these have to be renderable there. `pnpm
 * check:client-boundary` enforces the direction that typecheck, lint, build
 * and unit tests all miss.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Alert as ShadcnAlert } from '@/components/ui/alert';
import { isObserved, readingDisplay, type ConsoleReading } from '@/lib/ops/consoleReadings';

/* ─────────────────────────────────────────────────────────────────────────
   SURFACES
   ───────────────────────────────────────────────────────────────────────── */

/**
 * A framed surface.
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
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? <Heading className="ops-label">{title}</Heading> : null}
            {description ? (
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-subtle">{description}</p>
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
 * A titled block of a page. Renders `<h2>`, one level below the shell's
 * `<h1>`, which is the whole reason to prefer it over a bare `<section>`: it
 * keeps every page's heading outline consistent for a screen-reader operator.
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
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-subtle">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

/** Standard vertical rhythm for a dashboard body. One spacing, every page. */
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
   THE HONEST-DATA VOCABULARY

   This block is the reason four implementers will not each invent their own
   dash. Read it before rendering any value that could be missing.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * THE honest-value renderer. There is exactly one, and this is it.
 *
 * ─── WHY IT TAKES A ConsoleReading AND NOT A NULLABLE NUMBER ─────────────
 *
 * This is the single most important API decision in this module, so it is
 * enforced by the type rather than by a comment.
 *
 * Every upstream this console reads degrades the same way: it returns an
 * empty array and a flag. So `0` can mean "the control service answered and
 * the real value is zero" or "the control service is down". A primitive
 * shaped `value: number | null` collapses those two into one dash on screen,
 * and — this is the part that makes it dangerous — every unit test still
 * passes, because the model layer is tested separately from the renderer.
 *
 * A `ConsoleReading` cannot be constructed without saying which of the three
 * it is, so the distinction survives all the way to the glyph:
 *
 *   observed          the real value. `0` here is a fact an operator may act
 *                     on.
 *   not-yet-computed  the source answered and has nothing for this key yet.
 *                     Renders `-`, which means NOTHING TO REPORT.
 *   unavailable       the source did not answer. Renders `n/a`, which means
 *                     UNKNOWN — we could not read it.
 *
 * `-` and `n/a` are not stylistic variants of each other and must never be
 * unified. During an incident nobody reads the hint line underneath, so the
 * glyph itself has to carry which one it is.
 *
 * ─── AND WHY THE GLYPH IS NOT ENOUGH ON ITS OWN ──────────────────────────
 *
 * A screen reader announces `-` as nothing at all and `n/a` as "n a". Both
 * are useless. So each non-observed state also emits a screen-reader-only
 * phrase saying which it is, and the visible glyph is hidden from the
 * accessibility tree. A blind operator gets the same distinction a sighted
 * one does.
 */
export function OpsReading({
  reading,
  format,
  className,
}: {
  reading: ConsoleReading;
  /** How to render the number when it is real. Defaults to `String`. */
  format?: (value: number) => string;
  className?: string;
}) {
  if (isObserved(reading)) {
    return <span className={cn('tabular-nums', className)}>{readingDisplay(reading, format)}</span>;
  }

  const unknown = reading.availability === 'unavailable';
  return (
    <span
      className={cn('tabular-nums', unknown ? 'text-subtle' : 'text-muted-foreground', className)}
      data-availability={reading.availability}
      title={reading.detail}
    >
      <span aria-hidden>{unknown ? 'n/a' : '—'}</span>
      <span className="sr-only">
        {unknown ? 'unknown, could not be read' : 'nothing to report'}
      </span>
    </span>
  );
}

/**
 * A stat whose value comes from a source that can be down.
 *
 * This is the one to reach for on a console tile. It wires the reading's own
 * `detail` clause into the hint line automatically, so the tile always says
 * WHICH of the three states it is in without the caller remembering to.
 *
 * Use plain `OpsStat` only for a value that genuinely cannot be missing — a
 * count of rows already in hand, a constant from configuration.
 */
export function OpsReadingStat({
  label,
  reading,
  format,
  unit,
  hint,
  tone,
  className,
}: {
  label: ReactNode;
  reading: ConsoleReading;
  format?: (value: number) => string;
  unit?: ReactNode;
  /** Overrides the reading's own detail clause. Rarely correct. */
  hint?: ReactNode;
  tone?: OpsTone;
  className?: string;
}) {
  return (
    <OpsStat
      label={label}
      value={<OpsReading reading={reading} format={format} />}
      unit={isObserved(reading) ? unit : undefined}
      hint={hint ?? reading.detail}
      tone={isObserved(reading) ? (tone ?? 'default') : 'default'}
      className={className}
    />
  );
}

/**
 * Where a figure came from, and how sure the system is of it.
 *
 * Arrival times in this product carry a confidence band and a BASIS, and
 * decline by name when they cannot be measured. That is load-bearing: "22
 * min" alone is a promise the system cannot keep, and the product's premise
 * is not making it. The band is never optional when a point estimate is
 * shown.
 *
 * `basis` is the plain-language answer to "how do you know?" — for example
 * "from this bus's own speed" or "from other buses on this stretch, not this
 * one". Write it in the operator's words, not the model's.
 */
export function OpsConfidence({
  value,
  band,
  basis,
  className,
}: {
  /** The point estimate, already formatted. */
  value: ReactNode;
  /** The range around it, already formatted. Required whenever `value` is shown. */
  band: ReactNode;
  /** How the figure was arrived at, in plain language. */
  basis: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 leading-tight', className)}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="tabular-nums text-foreground">{value}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{band}</span>
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-subtle">{basis}</div>
    </div>
  );
}

/**
 * The system declining to give a figure, by name.
 *
 * The counterpart to OpsConfidence, and just as important: an estimate that
 * cannot be measured must say so in words rather than showing a dash and
 * letting the operator guess. Use the established phrasings — "Not confident
 * enough to give a time", "Too far ahead to time yet", "Reading is out of
 * date - waiting for a fresh one".
 */
export function OpsDeclined({ reason, className }: { reason: ReactNode; className?: string }) {
  return (
    <span className={cn('text-xs leading-snug text-muted-foreground', className)}>{reason}</span>
  );
}

/**
 * How much of a population a figure actually covers.
 *
 * "198 of 759 mapped" is the canonical form and it is deliberately not a
 * percentage: a percentage hides the denominator, and the denominator is the
 * honest part. `caveat` carries what the pair still does not tell you — most
 * often that the size of the full network is not known from here.
 *
 * Never render this as "26% coverage".
 */
export function OpsCoverage({
  covered,
  total,
  noun,
  caveat,
  className,
}: {
  covered: number;
  total: number;
  /** What is being counted, e.g. "mapped" or "that can report bunching". */
  noun: ReactNode;
  caveat?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 leading-tight', className)}>
      <span className="tabular-nums text-foreground">
        {covered} of {total}
      </span>{' '}
      <span className="text-xs text-muted-foreground">{noun}</span>
      {caveat ? <div className="mt-0.5 text-[11px] leading-snug text-subtle">{caveat}</div> : null}
    </div>
  );
}

/**
 * An English/Hindi pair, for anything a driver reads.
 *
 * ─── WHY THIS IS A PRIMITIVE ─────────────────────────────────────────────
 *
 * Three things have to be right every time and are easy to get wrong once
 * each across four lanes:
 *
 *   1. `lang="hi"` on the Devanagari. Without it a screen reader reads Hindi
 *      with an English voice, which is unintelligible.
 *   2. A taller line box on the Hindi. Devanagari ink spans 1.164em against
 *      Latin's 1.005em, so English's comfortable leading lets matras collide.
 *      `leading-hindi` (1.75) is the token for it.
 *   3. Both strings present. A bilingual control with only one language
 *      filled in is worse than a monolingual one, because it looks finished.
 *
 * Both props are required for that third reason.
 *
 * The font carries this correctly: one family, two unicode ranges, identical
 * vertical metrics — see src/app/fonts.ts for the measurements.
 */
export function OpsBilingual({
  en,
  hi,
  className,
  enClassName,
  hiClassName,
}: {
  en: ReactNode;
  hi: ReactNode;
  className?: string;
  enClassName?: string;
  hiClassName?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 flex-col', className)}>
      <span lang="en" className={cn('leading-snug', enClassName)}>
        {en}
      </span>
      <span lang="hi" className={cn('leading-hindi text-muted-foreground', hiClassName)}>
        {hi}
      </span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   READOUTS
   ───────────────────────────────────────────────────────────────────────── */

export type OpsTone = 'default' | 'accent' | 'good' | 'warn' | 'critical';

const TONE_TEXT: Record<OpsTone, string> = {
  default: 'text-foreground',
  accent: 'text-primary',
  good: 'text-success',
  warn: 'text-warning',
  critical: 'text-destructive',
};

/**
 * One number an operator reads at a glance.
 *
 * Tabular figures are not a flourish: a column whose digits change width
 * jitters on every poll, and a jittering number is one an operator stops
 * trusting. The body face carries a real `tnum`, so this no longer needs to
 * switch to mono to get it.
 *
 * If the value can be missing, use `OpsReadingStat` instead.
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
      <div className={cn('mt-1 text-lg tabular-nums', TONE_TEXT[tone])}>
        {value}
        {unit ? <span className="ml-1 text-xs text-subtle">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-subtle">{hint}</div> : null}
    </div>
  );
}

/**
 * The horizontal band of numbers directly under the shell chrome. Pass it to
 * `OpsShell`'s `statusStrip` slot rather than into the page body — the slot
 * is pinned above the scroll region, so the numbers stay on screen while an
 * operator scrolls a long incident list.
 */
export function OpsStatStrip({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  // Separated by space rather than hairline rules: a `:not(:first-child)`
  // divider indents whichever stat wraps onto a second row, so on a depot
  // tablet the strip visibly loses its left alignment. Spacing survives every
  // width.
  return (
    <div className={cn('flex flex-wrap items-start gap-x-10 gap-y-3 px-6 py-3', className)}>
      {children}
    </div>
  );
}

/**
 * A named cluster of stats inside an `OpsStatStrip`, captioned with what its
 * numbers are ABOUT.
 *
 * A strip that mixes populations needs this. The control room's band puts a
 * statewide vehicle count beside six readings from a single corridor, and
 * unlabelled they read as one set of facts about one thing — which overstates
 * what the console can see.
 */
export function OpsStatGroup({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {/* Deliberately not `.ops-eyebrow`: that is the caption over a single
          number, and reusing it would give a group the same visual weight as
          the stats it contains. */}
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.28em] text-subtle/90">
        {label}
      </div>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">{children}</div>
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
      <div className={cn('truncate text-sm tabular-nums', TONE_TEXT[tone])}>{value}</div>
    </div>
  );
}

/**
 * An identifier: a registration plate, a corridor id, a command reference.
 *
 * The one place mono is still correct. JetBrains Mono's zero has three
 * contours against its capital O's two — genuinely dotted — which matters
 * when an operator reads a plate aloud over a radio to a driver.
 *
 * Not for numbers. Numbers get `tabular-nums` on the body face.
 */
export function OpsIdentifier({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('font-mono text-[0.95em] tracking-tight', className)}>{children}</span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   STATUS AND PROVENANCE
   ───────────────────────────────────────────────────────────────────────── */

export type OpsBadgeVariant = 'live' | 'sim' | 'fixture' | 'critical' | 'neutral';

/**
 * The provenance/status chip.
 *
 * `live` / `sim` / `fixture` are the product's central honesty affordance:
 * an operator must always be able to tell observed data from modelled data,
 * and it only holds if the same source value looks the same on every
 * surface. Do not introduce a second green chip.
 *
 * ─── THE DOT IS A SHAPE, NOT JUST A COLOUR ───────────────────────────────
 *
 * Simulating deuteranopia on this product's own good/degraded pair separates
 * them by 1.22:1 — roughly one in twelve male operators cannot tell them
 * apart by hue. No palette fixes it. So each variant's dot has a distinct
 * SHAPE as well as a hue (filled disc / ringed / hollow / square), and the
 * chip always carries its state in words. Colour is the third encoding here,
 * not the first.
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
  const badgeVariant =
    variant === 'neutral' ? 'outline' : (variant as Exclude<OpsBadgeVariant, 'neutral'>);

  return (
    <Badge variant={badgeVariant} className={className}>
      {dot ? <OpsStatusDot variant={variant} /> : null}
      {children}
    </Badge>
  );
}

/**
 * The redundant-encoding mark that makes a state readable without colour.
 *
 * Shape carries the state; hue reinforces it. See OpsBadge for why that
 * ordering is not negotiable.
 */
export function OpsStatusDot({
  variant,
  className,
}: {
  variant: OpsBadgeVariant;
  className?: string;
}) {
  const shape =
    variant === 'live'
      ? 'rounded-full bg-instrument-success' // filled disc
      : variant === 'sim'
        ? 'rounded-full border-2 border-instrument-warning bg-transparent' // hollow ring
        : variant === 'fixture'
          ? 'rounded-none border border-primary bg-primary/40' // square
          : variant === 'critical'
            ? 'rounded-full bg-instrument-danger ring-2 ring-instrument-danger/40' // ringed disc
            : 'rounded-full border border-subtle bg-transparent'; // hollow neutral

  return <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0', shape, className)} />;
}

export type OpsAlertTone = 'info' | 'success' | 'warning' | 'error';

/**
 * An inline message about the state of the SURFACE, not of a form field.
 *
 * `warning` and `error` announce as `role="alert"` and the quieter tones as
 * `role="status"`. That distinction is what matters on a console: an
 * operator on shift must be interrupted by "the feed is down" and must not
 * be interrupted by "12 vehicles shown".
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
    <ShadcnAlert
      variant={tone === 'error' ? 'destructive' : tone}
      role={assertive ? 'alert' : 'status'}
      data-tone={tone}
      className={className}
      {...rest}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children}
    </ShadcnAlert>
  );
}

/**
 * What a table or list says when it has nothing in it.
 *
 * Always take a caller-supplied label: "no vehicles reporting" is reassuring
 * on a quiet night and dangerously wrong during an outage, and only the
 * caller knows which one it is.
 */
export function OpsEmptyState({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('ops-well px-4 py-6 text-center text-sm text-muted-foreground', className)}>
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
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="mt-1 text-[11px] leading-snug text-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-[11px] leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function OpsInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('ops-input', className)} {...rest} />;
}

export function OpsSelect({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('ops-input', className)} {...rest} />;
}

export function OpsTextarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('ops-input', 'min-h-24 resize-y', className)} {...rest} />;
}

/** A row of controls above a table or panel body. */
export function OpsToolbar({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-3', className)}>{children}</div>;
}

/* ─────────────────────────────────────────────────────────────────────────
   TABLES
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Table class constants rather than a `<OpsTable columns rows>` component, on
 * purpose. Ops tables differ in every way that matters — a cell is a badge
 * here, a countdown there, a link somewhere else — and a data-driven table
 * component either grows a prop for each of those or gets abandoned.
 * Constants give every table the same frame, header treatment and row rhythm
 * while leaving the cells entirely to the dashboard.
 *
 * `OpsTableFrame` is the one piece worth wrapping: it carries the horizontal
 * scroll container, without which a wide fleet table blows out the page on a
 * depot tablet.
 */
export const opsTableClass = 'w-full text-left text-sm';
export const opsTheadRowClass =
  'border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground';
export const opsThClass = 'px-3 py-2 font-medium';
export const opsTrClass = 'border-b border-border/60 text-foreground last:border-0';
export const opsTdClass = 'px-3 py-2';
/** Secondary cell — the reading is real but is not what the row is about. */
export const opsTdMutedClass = 'px-3 py-2 text-muted-foreground';
/** Any cell holding a number that updates. See OpsStat on why tabular. */
export const opsTdNumericClass = 'px-3 py-2 tabular-nums';

export function OpsTableFrame({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-border', className)}>
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
 * Two guarantees, both learned the hard way:
 *
 *   1. A DEFINITE HEIGHT. Google Maps sizes itself to its container; a
 *      container that is `h-full` inside an `auto`-height ancestor resolves
 *      to zero and the map renders as a blank strip. This sets an explicit
 *      minimum and expects to sit inside `OpsShell variant="full"`, whose
 *      main pane is a real flex child with `min-h-0`.
 *
 *   2. NO `transform: scale` ON ANY ANCESTOR. The fleet canvas overlay
 *      projects vehicle positions in LAYOUT PIXELS, so a transform scale
 *      above it slides every bus off the road. Nothing here scales, nothing
 *      in OpsShell scales, and nothing wrapping this may. If a responsive
 *      rewrite needs to shrink this, use `zoom` or change the layout — never
 *      a transform. This is written in four places in the codebase and still
 *      needs saying.
 *
 * `overlay` renders above the map, inside the frame, with pointer events off
 * by default so it cannot eat a drag on the basemap; give an interactive
 * child `pointer-events-auto`.
 *
 * NOTE for the map lane: the Google basemap is a JavaScript style array, not
 * CSS, so it does NOT follow the theme through a class. The map component
 * must subscribe to `useTheme().resolved` and call `setOptions` when it
 * changes, or a light console will render over a black basemap.
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
        'relative isolate h-full w-full overflow-hidden rounded-lg border border-border bg-background',
        className,
      )}
      style={{ minHeight }}
    >
      {children}
      {overlay ? <div className="pointer-events-none absolute inset-0 z-10">{overlay}</div> : null}
    </div>
  );
}
