import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorPanel, GENERIC_ERROR_BODY } from '@/components/depot/shell/DataStates';
import { DEPOT_UNAVAILABLE_MESSAGE } from '@/hooks/usePolledJson';

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, '');
}

describe('ErrorPanel', () => {
  it('shows the title it is given, then the body, then Retry', () => {
    const markup = renderToStaticMarkup(
      <ErrorPanel
        title="Parking plan unavailable"
        message="Session expired"
        onRetry={() => undefined}
      />,
    );
    expect(textOf(markup)).toBe('Parking plan unavailableSession expiredRetry');
    expect(markup).toContain('role="alert"');
  });

  it('replaces the generic hook reason, so the body never repeats a depot-data title', () => {
    const markup = renderToStaticMarkup(
      <ErrorPanel
        title="Could not load the league"
        message={DEPOT_UNAVAILABLE_MESSAGE}
        onRetry={() => undefined}
      />,
    );
    expect(textOf(markup)).toBe(`Could not load the league${GENERIC_ERROR_BODY}Retry`);
    expect(textOf(markup)).not.toContain('Depot data unavailable');
  });

  it('does not carry the overview wording', () => {
    expect(GENERIC_ERROR_BODY).not.toMatch(/network service|Nothing is shown/);
  });

  it('cannot be rendered without a title', () => {
    // @ts-expect-error title is required: a missing title must not type-check
    const element = <ErrorPanel message="x" onRetry={() => undefined} />;
    expect(element).toBeDefined();
  });
});
