import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RebalanceMethod } from '@/components/depot/rebalance/RebalanceMethod';
import { SCORE_WINDOW_MIN } from '@/lib/depot/score/window';

/*
 * The distribution page's closing disclosure says what the requirement rests on:
 * each depot's busiest windowed on-road share so far today, which holds once the
 * morning peak has passed and is per server.
 */

function text(): string {
  return renderToStaticMarkup(<RebalanceMethod spareRatio={0.1} />)
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, ' ');
}

describe('how the requirement is produced', () => {
  it('says the requirement reads the busiest window so far today and then holds', () => {
    const body = text();
    expect(body).toContain(`busiest ${SCORE_WINDOW_MIN}-minute on-road share so far today`);
    expect(body).toContain('can still change until the morning peak has passed and then holds');
    expect(body).toContain('a bus taken off the road still lowers what is available');
  });

  it('says two servers can differ until each has seen the peak', () => {
    const body = text();
    expect(body).toContain('two servers can differ until each has seen the peak');
    expect(body).toContain('one restarted later in the day starts again from what it then sees');
  });
});
