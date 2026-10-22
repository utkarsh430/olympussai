'use client';

import { SECTION } from '@/lib/depot/redistribution/wording';

/** Scrolls a section's heading into view, smoothly where the browser can. */
export function scrollToSection(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const ORDER = [SECTION.overview, SECTION.heatmap, SECTION.recommendations, SECTION.impact, SECTION.timeline, SECTION.briefing] as const;

/** The six sections as numbered jump links under the header. */
export function SectionNav() {
  return (
    <nav aria-label="Sections of this page" className="flex flex-wrap gap-1.5" data-testid="section-nav">
      {ORDER.map((s, i) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="depot-filter-button inline-flex items-center gap-1.5 no-underline"
          onClick={(e) => {
            e.preventDefault();
            scrollToSection(s.id);
          }}
        >
          <span className="text-depot-faint">{String(i + 1).padStart(2, '0')}</span>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
