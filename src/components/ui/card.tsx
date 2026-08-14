import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn's card, reduced to the part this product uses.
 *
 * The generated file also shipped `CardHeader`, `CardTitle`, `CardDescription`,
 * `CardContent` and `CardFooter`. None was ever imported: the ops console
 * composes panels through `OpsPanel` / `OpsSection`
 * (src/components/ops/ui/primitives.tsx), which carry the console's own
 * heading levels and spacing, and the landing page's one card
 * (src/components/landing/SectionResearch.tsx) lays out its own contents. Five
 * unused padding wrappers are five ways for a future card to be spaced
 * differently from every panel beside it, so they are gone rather than kept
 * "in case".
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl border bg-card text-card-foreground shadow', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export { Card };
