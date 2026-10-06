import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CockpitMethod } from '@/components/depot/cockpit/CockpitMethod';
import { REPORTING_WINDOW_MIN } from '@/lib/depot/infer/thresholds';
import type { StatusMix } from '@/lib/depot/types';

describe('the cockpit method note', () => {
  it('states the not-heard window from the engine constant', () => {
    const markup = renderToStaticMarkup(
      <CockpitMethod
        fleet={10}
        yardSentence="No yard yet."
        yardEstablished={false}
        status={{} as StatusMix}
      />,
    );
    expect(markup).toContain(`A bus heard more than ${REPORTING_WINDOW_MIN} minutes ago keeps`);
  });
});
