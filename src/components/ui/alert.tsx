import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Alert, vendored, with the product's own tones added.
 *
 * shadcn ships `default` and `destructive` only. An operations console needs
 * four, because the distinction between "the feed is down" and "12 vehicles
 * shown" is the difference between interrupting an operator on shift and not.
 * `warning` and `destructive` announce assertively; the quieter tones do not.
 * That routing lives in OpsAlert, which is what pages should actually use.
 */
const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground [&>svg]:text-muted-foreground',
        info: 'border-primary/35 bg-primary/[0.07] text-foreground [&>svg]:text-primary',
        success:
          'border-instrument-success/40 bg-instrument-success/10 text-success [&>svg]:text-success',
        warning:
          'border-instrument-warning/40 bg-instrument-warning/10 text-warning [&>svg]:text-warning',
        destructive:
          'border-instrument-danger/45 bg-instrument-danger/10 text-destructive [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('mb-1 font-medium leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
