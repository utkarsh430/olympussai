import { LandingBackdrop } from '@/components/landing/LandingBackdrop';
import { CanvasMount } from '@/components/landing/CanvasMount';
import { SiteHeader } from '@/components/landing/SiteHeader';
import { SiteFooter } from '@/components/landing/SiteFooter';
import { HeroArrival } from '@/components/landing/HeroArrival';
import { SectionAscent } from '@/components/landing/SectionAscent';
import { SectionExploration } from '@/components/landing/SectionExploration';
import { SectionResearch } from '@/components/landing/SectionResearch';
import { SectionIntelligence } from '@/components/landing/SectionIntelligence';
import { SectionPortal } from '@/components/landing/SectionPortal';

/**
 * Olympuss AI landing experience (Sections 20–27).
 *
 * Layering: a static CSS backdrop (always), a lazy-loaded fixed WebGL canvas
 * (enhancement, never on dashboard routes thanks to route code-splitting), and
 * accessible HTML content above both. The WebGL bundle is dynamically imported
 * with SSR disabled so the HTML renders immediately.
 */
export default function LandingPage() {
  return (
    <>
      <LandingBackdrop />
      <CanvasMount />

      <SiteHeader />

      <main id="content" className="relative z-10">
        <HeroArrival />
        <SectionAscent />
        <SectionExploration />
        <SectionResearch />
        <SectionIntelligence />
        <SectionPortal />
      </main>

      <SiteFooter />
    </>
  );
}
