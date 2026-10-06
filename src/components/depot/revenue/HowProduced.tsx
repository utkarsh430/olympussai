import Link from 'next/link';
import { HowProduced as ClosingDisclosure } from '@/components/depot/shell/HowProduced';

const SOURCES_PATH = '/project/depots/sources';

/**
 * The closing disclosure of a modelled page (fuel, revenue, economics): what the page
 * used to say in its closing panel (what is modelled, the definitions, the assumptions,
 * the price used and the feeds that would replace the model), then where each feed's
 * fields are listed. The disclosure itself is the shared one.
 */
export function HowProduced({ paragraphs }: { readonly paragraphs: readonly string[] }) {
  return (
    <ClosingDisclosure paragraphs={paragraphs}>
      <p className="depot-prose">
        The fields each feed must provide are listed on the{' '}
        <Link href={SOURCES_PATH} className="depot-link">
          Data sources page
        </Link>
        .
      </p>
    </ClosingDisclosure>
  );
}
