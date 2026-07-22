'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCopilotStore } from '@/stores/copilotStore';
import { useLiveFleet } from '@/hooks/useLiveFleet';
import { useSchedule } from '@/hooks/useSchedule';
import { useAlertStream } from '@/hooks/useAlertStream';
import { AmbientBackdrop } from '@/components/shared/hud';
import { TopCommandBar } from './TopCommandBar';
import { IntelligenceStrip } from './IntelligenceStrip';
import { FleetPanel } from '@/components/live-fleet/FleetPanel';
import { AlertCentre } from '@/components/alerts/AlertCentre';
import { AlertToasts } from '@/components/alerts/AlertToasts';
import { FleetMap } from '@/components/map/FleetMap';
import { CopilotPanel } from '@/components/ai-core/CopilotPanel';
import { BusDetailDrawer } from '@/components/bus-details/BusDetailDrawer';
import { ScenarioStage } from '@/components/scenarios/ScenarioStage';
import { ScenarioLab } from '@/components/scenarios/ScenarioLab';
import { DriverMessageModal } from '@/components/communication/DriverMessageModal';
import { VoipCallOverlay } from '@/components/communication/VoipCallOverlay';
import { PitchMode } from '@/components/pitch-mode/PitchMode';
import { ImpactDashboard } from '@/components/impact-dashboard/ImpactDashboard';
import { DiagnosticsDrawer } from '@/components/diagnostics/DiagnosticsDrawer';
import { AuditDrawer } from '@/components/audit/AuditDrawer';
import { FooterDisclaimer } from '@/components/shared/FooterDisclaimer';
import { FleetErrorBanner } from './FleetErrorBanner';

export function CommandCenter() {
  const hydrateAudit = useCopilotStore((state) => state.hydrateAudit);
  const [visibleCount, setVisibleCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Live UPSRTC polling + on-demand schedule fetch.
  useLiveFleet();
  useSchedule();
  useAlertStream();

  useEffect(() => {
    hydrateAudit();
  }, [hydrateAudit]);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => {
        // Fullscreen can be blocked by policy — the demo continues windowed.
      });
    }
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-void">
      <AmbientBackdrop />

      <TopCommandBar
        visibleCount={visibleCount}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />

      <FleetErrorBanner />

      <main
        id="command-main"
        className="relative z-10 flex min-h-0 flex-1 gap-2 p-3"
        aria-label="Command centre"
      >
        <FleetPanel onVisibleCountChange={setVisibleCount} />
        <AlertCentre />

        <section className="relative min-w-0 flex-1" aria-label="Fleet map and analysis stage">
          <FleetMap />
          <AlertToasts />
          <BusDetailDrawer />
          <ScenarioStage />
        </section>

        <CopilotPanel />
      </main>

      <IntelligenceStrip />
      <FooterDisclaimer />

      {/* Overlays */}
      <ScenarioLab />
      <DriverMessageModal />
      <VoipCallOverlay />
      <ImpactDashboard />
      <DiagnosticsDrawer />
      <AuditDrawer />
      <PitchMode />
    </div>
  );
}
