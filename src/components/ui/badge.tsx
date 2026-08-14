import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Badge, vendored, with the product's PROVENANCE variants added.
 *
 * `live` / `sim` / `fixture` are not decoration. This product's central
 * claim is that an operator can always tell observed data from modelled
 * data, and that only holds if the same source value looks the same on every
 * surface. Do not introduce a second green chip.
 *
 * Every provenance variant is also given a distinct DOT SHAPE by OpsBadge —
 * see the colour-blindness note in globals.css. Colour does not carry these
 * on its own.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-input text-muted-foreground',
        /** Observed from a live source. */
        live: 'border-instrument-success/45 bg-instrument-success/10 text-success',
        /** Modelled or invented. Never let this look like `live`. */
        sim: 'border-instrument-warning/50 bg-instrument-warning/10 text-warning',
        /** Canned fixture data standing in for a source. */
        fixture: 'border-primary/40 bg-primary/10 text-primary',
        critical: 'border-instrument-danger/50 bg-instrument-danger/10 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
