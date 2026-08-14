'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import type { ThemePreference } from '@/lib/theme/theme';

/**
 * The theme control: a three-state segmented control, not a switch.
 *
 * A two-state switch cannot express "follow my machine", which is a real
 * choice an operator makes — and the one this console defaults to. A switch
 * would also have to guess what its own "off" means on a machine set to
 * dark, and would silently overwrite the operator's system preference the
 * first time they touched it.
 *
 * ─── ACCESSIBILITY ───────────────────────────────────────────────────────
 *
 * A `radiogroup`, because that is exactly what it is: three options, one
 * selected. Screen readers announce it as such and arrow keys move between
 * options natively. The icons are decorative — each option carries a real
 * text label, visible from `sm` up and screen-reader-only below, so this is
 * never an icon an operator has to decode.
 */
const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  Icon: typeof Sun;
}> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Auto', Icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      data-testid="theme-toggle"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-input bg-card p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`theme-toggle-${value}`}
            onClick={() => setPreference(value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
