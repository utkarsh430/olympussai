import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { FuelResponse } from '@/lib/depot/fuel/api';
import { formatRupees } from '@/lib/depot/fuel/format';
import {
  formatCostPerKm,
  formatKm,
  formatKmPerLitre,
  formatLitres,
  summarySentence,
} from '@/lib/depot/fuel/fuelPageModel';

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0 border-l border-depot-line pl-3">
      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[15px] tabular-nums text-depot-ink">{value}</dd>
    </div>
  );
}

/** The depot's day in words and figures, all tagged MODELLED. */
export function FuelSummary({ data }: { readonly data: FuelResponse }) {
  const { totals } = data;
  return (
    <section aria-labelledby="depot-fuel-summary-heading" className="animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-fuel-summary-heading" className="depot-section-label !mb-0">
          The day, {data.operatingDate}
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <p className="depot-prose mb-3" role="status">
        {summarySentence(totals, { price: data.pricePerLitre, defaulted: data.priceDefaulted })}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        <Figure label="Distance" value={formatKm(totals.distanceKm)} />
        <Figure label="Fuel issued" value={formatLitres(totals.fuelLitres)} />
        <Figure label="Cost" value={formatRupees(totals.cost)} />
        <Figure label="Km per litre" value={formatKmPerLitre(totals.kmPerLitre)} />
        <Figure label="Cost per km" value={formatCostPerKm(totals.costPerKm)} />
        <Figure
          label={data.priceDefaulted ? 'Planning price per litre' : 'Price per litre'}
          value={formatRupees(data.pricePerLitre)}
        />
      </dl>
    </section>
  );
}
