'use client';

import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { serviceFigures } from '@/lib/depot/service/servicePageModel';
import { SERVICE_TEXT } from '@/lib/depot/service/serviceWording';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';

/**
 * The current hour in four figures: deployed (from the feed), needed (MODELLED, tagged
 * on its own figure since the page is mixed), the gap in its meaning's tone with the
 * gap in words as its caption, and the samples the day's observation rests on.
 */
export function ServiceFigureBand({ response }: { readonly response: RouteHourlyResponse }) {
  const figures = serviceFigures(response);
  return (
    <div data-testid="service-figure-band">
      <FigureBand label={SERVICE_TEXT.bandLabel}>
        {figures.map((f) => (
          <Figure
            key={f.label}
            label={f.label}
            value={f.value}
            caption={f.caption}
            tag={f.tag}
            tone={f.tone}
          />
        ))}
      </FigureBand>
    </div>
  );
}
