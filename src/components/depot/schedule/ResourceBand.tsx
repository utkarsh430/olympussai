import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import type { ScheduleFigure } from '@/lib/depot/schedule/schedulePageModel';

export function ResourceBand({ figures }: { readonly figures: readonly ScheduleFigure[] }) {
  return (
    <FigureBand label="Plan figures">
      {figures.map((f) => (
        <Figure key={f.key} label={f.label} value={f.value} caption={f.caption} tone={f.tone} lead={f.lead} />
      ))}
    </FigureBand>
  );
}
