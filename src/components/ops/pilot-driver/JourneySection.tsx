'use client';

import { Component, type ReactNode } from 'react';
import { OpsAlert, OpsPanel } from '@/components/ops/ui';
import { DriverJourneyPanel } from './DriverJourneyPanel';

/**
 * The route section, fenced off from the command console above it.
 *
 * ─── WHY A BOUNDARY, AND WHY HERE ────────────────────────────────────────
 *
 * The command console on this page is safety-critical: it is the only place a
 * driver sees an instruction from the control room and the only place they can
 * answer it. Until now it was the whole page, so nothing else could break it.
 *
 * This ticket puts a map, two polled datasources and a third-party SDK on the
 * same page. In React, an uncaught render error anywhere in a tree unmounts the
 * WHOLE tree - so without this, a malformed arrival response or a Google Maps
 * failure would replace a live command with a blank screen, and the driver
 * would never know an instruction had been sent. That is a strictly worse
 * failure than not having the route screen at all.
 *
 * So the route lives inside an error boundary, and the boundary is drawn here
 * rather than around the whole page: the console must stay OUTSIDE it. A
 * boundary that contained both would defeat its own purpose.
 *
 * The fallback is deliberately plain and says what is still working, because
 * the one thing a driver must not conclude from a broken route panel is that
 * the console has stopped too.
 */
export class JourneySection extends Component<Record<string, never>, { failed: boolean }> {
  constructor(props: Record<string, never>) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <OpsPanel title="Your route" headingLevel={2}>
          <OpsAlert tone="warning" title="The route view could not be shown">
            <p className="text-base leading-relaxed">
              Your instructions above are still working normally. Reload the page to try the route view
              again.
            </p>
          </OpsAlert>
        </OpsPanel>
      );
    }

    return <DriverJourneyPanel />;
  }
}
