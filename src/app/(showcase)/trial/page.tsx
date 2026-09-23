import trialDataJson from '@/lib/showcase/generated/trialData.json';
import { showcaseFigures } from '@/lib/showcase/figures';
import { resolveShowcase } from '@/lib/showcase/resolve';
import { parseTrialData } from '@/lib/showcase/trialData';
import { ShowcaseStage } from '@/components/showcase/ShowcaseStage';
import { HeroScene } from '@/components/showcase/HeroScene';
import { VerdictScene } from '@/components/showcase/VerdictScene';
import { LiveTrialScene } from '@/components/showcase/LiveTrialScene';
import { ScenarioGalleryScene } from '@/components/showcase/ScenarioGalleryScene';
import { ControllerPipelineScene } from '@/components/showcase/ControllerPipelineScene';
import { PassengerBalanceScene } from '@/components/showcase/PassengerBalanceScene';
import { ScaleProjectionScene } from '@/components/showcase/ScaleProjectionScene';
import { ReportScene } from '@/components/showcase/ReportScene';

/**
 * The fleet trial, presented.
 *
 * Eight scenes, each a viewport, each fed a slice of ONE view model resolved
 * on the server from the authored figures (`lib/showcase/figures.ts`) and the
 * shapes a real `sim:fleet` run produced (`lib/showcase/generated`). The
 * scenes carry no numbers of their own, so a change to a figure reaches every
 * surface that quotes it in one edit.
 *
 * The JSON is imported HERE and nowhere else: slices go down as props, so the
 * client bundle never carries the whole file.
 */
export const SHOWCASE_SCENES = [
  { id: 'hero', label: 'Fleet trial' },
  { id: 'verdict', label: 'The verdict' },
  { id: 'live', label: 'Live trial' },
  { id: 'scenarios', label: 'Every scenario' },
  { id: 'pipeline', label: 'How it works' },
  { id: 'balance', label: "The passenger's bill" },
  { id: 'scale', label: 'The whole network' },
  { id: 'report', label: 'The report' },
] as const;

export default function TrialPage() {
  const model = resolveShowcase(showcaseFigures, parseTrialData(trialDataJson));

  return (
    <ShowcaseStage scenes={SHOWCASE_SCENES}>
      <main id="content">
        <section id="hero" data-scene className="sc-scene">
          <HeroScene model={model.hero} />
        </section>
        <section id="verdict" data-scene className="sc-scene">
          <VerdictScene model={model.verdict} />
        </section>
        <section id="live" data-scene className="sc-scene">
          <LiveTrialScene model={model.liveTrial} />
        </section>
        <section id="scenarios" data-scene className="sc-scene">
          <ScenarioGalleryScene model={model.gallery} />
        </section>
        <section id="pipeline" data-scene className="sc-scene">
          <ControllerPipelineScene model={model.pipeline} />
        </section>
        <section id="balance" data-scene className="sc-scene">
          <PassengerBalanceScene model={model.balance} />
        </section>
        <section id="scale" data-scene className="sc-scene">
          <ScaleProjectionScene model={model.scale} />
        </section>
        <section id="report" data-scene className="sc-scene">
          <ReportScene model={model.report} />
        </section>
      </main>
    </ShowcaseStage>
  );
}
