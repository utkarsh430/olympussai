import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        /* ── IDENTITY VARIANTS ───────────────────────────────────────────
           The front door's call to action. Gold, and gold ONLY here: the
           console's own buttons are `default` and wear --primary, because
           an operator must never learn that gold means something about a
           bus. Added as variants rather than as a hand-rolled className on
           the landing page so there is one button component with one focus
           ring, one disabled state and one hit target across the product.

           `shadow-brand` is a warm lift rather than the neutral one — a
           cool shadow under a gold button reads as a printing error. */
        brand: 'bg-brand text-brand-foreground shadow-brand hover:bg-brand/90',
        brandOutline: 'border border-brand bg-transparent text-brand hover:bg-brand/10',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
        /* Landing-scale. 48px clears the 44px touch minimum with room, which
           matters because /login is reached from a phone more often than
           from a desk. */
        xl: 'h-12 rounded-md px-8 text-[13px] uppercase tracking-[0.18em]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
