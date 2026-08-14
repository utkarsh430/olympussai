// @vitest-environment jsdom
//
// The honest-data primitives.
//
// ─── WHY THIS SUITE IS WORTH MORE THAN IT LOOKS ──────────────────────────
//
// This product's premise is that it does not lie about data, and the entire
// weight of that premise lands on two glyphs:
//
//     -     nothing to report. The source answered; it has nothing yet.
//     n/a   unknown. The source did not answer. We cannot see.
//
// Collapsing them is the single most damaging regression available in this
// codebase, and it is invisible to every other gate: the model layer is
// tested separately from the renderer, so a `<Stat value={number | null}>`
// that draws one dash for both states passes typecheck, lint, build and
// every existing unit test.
//
// A redesign is exactly when that happens, because a primitive taking a
// nullable number is the obvious, tidy-looking API. So the distinction is
// pinned here, at the renderer, on the real component four implementers will
// use.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  OpsReading,
  OpsReadingStat,
  OpsBilingual,
  OpsCoverage,
  OpsConfidence,
  OpsBadge,
} from '@/components/ops/ui';
import { observed, notYetComputed, unavailable, formatSeconds } from '@/lib/ops/consoleReadings';

describe('OpsReading — the one honest-value renderer', () => {
  it('shows a real value, including a real zero', () => {
    // A `0` from a source that answered is a fact an operator may act on and
    // must never be dashed out.
    render(<OpsReading reading={observed(0, 'from the control service')} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows `-` for nothing-to-report', () => {
    render(<OpsReading reading={notYetComputed('no gap reading taken yet')} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('n/a')).not.toBeInTheDocument();
  });

  it('shows `n/a` for unknown', () => {
    render(<OpsReading reading={unavailable('the control service did not answer')} />);
    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('renders the two empty states as VISIBLY different glyphs', () => {
    // The assertion that actually protects the vocabulary. During an incident
    // nobody reads the hint line, so the glyph alone has to carry which of
    // the two states this is.
    const { container: nothing } = render(<OpsReading reading={notYetComputed('x')} />);
    const { container: unknown } = render(<OpsReading reading={unavailable('y')} />);
    expect(nothing.textContent).not.toEqual(unknown.textContent);
  });

  it('announces each empty state in words, because a dash reads as silence', () => {
    // A screen reader announces `—` as nothing at all and `n/a` as "n a".
    // Both are useless, so the meaning is carried in screen-reader-only text
    // and the glyph is hidden from the accessibility tree.
    render(<OpsReading reading={unavailable('the control service did not answer')} />);
    expect(screen.getByText('unknown, could not be read')).toBeInTheDocument();

    render(<OpsReading reading={notYetComputed('no sample yet')} />);
    expect(screen.getByText('nothing to report')).toBeInTheDocument();
  });

  it('tags the availability on the element, so a lane can style it without re-deriving it', () => {
    const { container } = render(<OpsReading reading={unavailable('down')} />);
    expect(container.querySelector('[data-availability="unavailable"]')).not.toBeNull();
  });

  it('applies the caller’s formatter only to real values', () => {
    render(<OpsReading reading={observed(420, 'measured')} format={formatSeconds} />);
    expect(screen.getByText('420s')).toBeInTheDocument();
  });
});

describe('OpsReadingStat', () => {
  it('carries the reading’s own detail into the hint, so a tile always says which state it is in', () => {
    render(
      <OpsReadingStat
        label="Average gap"
        reading={unavailable('the control service did not answer')}
      />,
    );
    expect(screen.getByText('Average gap')).toBeInTheDocument();
    expect(screen.getByText('the control service did not answer')).toBeInTheDocument();
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('suppresses the unit when there is no value to attach it to', () => {
    // "n/a s" is nonsense and reads as a measurement.
    render(<OpsReadingStat label="Average gap" reading={unavailable('down')} unit="seconds" />);
    expect(screen.queryByText('seconds')).not.toBeInTheDocument();
  });

  it('shows the unit when the value is real', () => {
    render(<OpsReadingStat label="Average gap" reading={observed(7, 'measured')} unit="seconds" />);
    expect(screen.getByText('seconds')).toBeInTheDocument();
  });

  it('does not colour a missing reading as though it were a judgement', () => {
    // A `warn`-toned tile showing n/a states that something is wrong with the
    // corridor, when what is actually wrong is that we cannot see it.
    const { container } = render(
      <OpsReadingStat label="Extra wait" reading={unavailable('down')} tone="critical" />,
    );
    expect(container.querySelector('.text-destructive')).toBeNull();
  });
});

describe('OpsCoverage', () => {
  it('keeps the denominator visible rather than collapsing to a percentage', () => {
    // "26% coverage" hides the denominator, and the denominator is the honest
    // part of this figure.
    render(<OpsCoverage covered={198} total={759} noun="mapped" />);
    expect(screen.getByText('198 of 759')).toBeInTheDocument();
    expect(screen.getByText('mapped')).toBeInTheDocument();
  });

  it('carries the caveat about what the pair still does not say', () => {
    render(
      <OpsCoverage
        covered={198}
        total={759}
        noun="mapped"
        caveat="the size of the full network is not known here"
      />,
    );
    expect(screen.getByText('the size of the full network is not known here')).toBeInTheDocument();
  });
});

describe('OpsConfidence', () => {
  it('never shows a point estimate without its band and its basis', () => {
    render(<OpsConfidence value="22 min" band="15–43 min" basis="From this bus's own speed" />);
    expect(screen.getByText('22 min')).toBeInTheDocument();
    expect(screen.getByText('15–43 min')).toBeInTheDocument();
    expect(screen.getByText("From this bus's own speed")).toBeInTheDocument();
  });
});

describe('OpsBilingual', () => {
  it('marks the Hindi with lang="hi" so it is not read in an English voice', () => {
    const { container } = render(<OpsBilingual en="Not safe" hi="सुरक्षित नहीं" />);
    const hindi = container.querySelector('[lang="hi"]');
    expect(hindi).not.toBeNull();
    expect(hindi?.textContent).toBe('सुरक्षित नहीं');
  });

  it('marks the English too, so a mixed page announces both correctly', () => {
    const { container } = render(<OpsBilingual en="Not safe" hi="सुरक्षित नहीं" />);
    expect(container.querySelector('[lang="en"]')?.textContent).toBe('Not safe');
  });

  it('gives the Hindi a taller line box, because matras collide at English leading', () => {
    // Devanagari ink spans 1.164em against Latin's 1.005em.
    const { container } = render(<OpsBilingual en="Not safe" hi="सुरक्षित नहीं" />);
    expect(container.querySelector('[lang="hi"]')?.className).toContain('leading-hindi');
  });
});

describe('OpsBadge — provenance', () => {
  it.each(['live', 'sim', 'fixture'] as const)('renders the %s provenance chip', (variant) => {
    render(<OpsBadge variant={variant}>{variant}</OpsBadge>);
    expect(screen.getByText(variant)).toBeInTheDocument();
  });

  it('gives each provenance state a DISTINCT dot shape, not just a hue', () => {
    // Roughly one in twelve male operators cannot separate this product's
    // good/degraded pair by hue at all (1.22:1 under simulated deuteranopia),
    // and no palette fixes it. Shape has to carry the state.
    const shapes = (['live', 'sim', 'fixture', 'critical'] as const).map((variant) => {
      const { container } = render(<OpsBadge variant={variant}>x</OpsBadge>);
      return container.querySelector('span[aria-hidden]')?.className ?? '';
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('always carries its state in words as well as in the chip', () => {
    render(<OpsBadge variant="sim">Simulated</OpsBadge>);
    expect(screen.getByText('Simulated')).toBeInTheDocument();
  });
});
