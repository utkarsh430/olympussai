/**
 * Static visual harness for the ops shell and its primitives.
 *
 * Renders the real components to a standalone HTML file with a real Tailwind
 * build, so the console can be looked at without a database, a Supabase
 * session or a running app. Development aid; nothing imports it.
 *
 *   pnpm tsx --tsconfig scripts/tsconfig.preview.json scripts/preview-ops-shell.tsx \
 *     > /tmp/ops-preview.body.html
 *
 * Pass `map` to render the full-viewport map variant instead of the document
 * one, which is the layout the fleet map depends on.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { OpsShell } from '../src/components/ops/OpsShell';
import {
  OpsAlert,
  OpsBadge,
  OpsButton,
  OpsEmptyState,
  OpsField,
  OpsGrid,
  OpsInput,
  OpsMapFrame,
  OpsPanel,
  OpsReadout,
  OpsSection,
  OpsSelect,
  OpsStack,
  OpsStat,
  OpsStatStrip,
  OpsTableFrame,
  OpsToolbar,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTdNumericClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '../src/components/ops/ui';

/** Same treatment every registration/id cell on the surface gets. */
const cellMono = 'px-3 py-2 font-mono';

const rows = [
  ['UP25FT4823', 'Bareilly Express', 'Bareilly', '42', 'Live'],
  ['UP32AN9910', 'Lucknow – Kanpur', 'Alambagh', '0', 'Degraded'],
  ['UP78BX2201', 'Kanpur City', 'Fazalganj', '18', 'Live'],
];

const wide = (
  <OpsShell
    title="Control Room"
    email="control.room@upsrtc.olympuss.local"
    role="control_room"
    variant="wide"
    actions={<OpsButton variant="primary">Issue command</OpsButton>}
    statusStrip={
      <OpsStatStrip>
        <OpsStat label="Live vehicles" value="9,170" tone="accent" />
        <OpsStat label="Reporting" value="8,412" hint="92% of fleet" />
        <OpsStat label="Open incidents" value="7" tone="warn" />
        <OpsStat label="Kill switches" value="1" tone="critical" hint="Route 41 up-direction" />
        <OpsStat label="Mean headway" value="11.4" unit="min" />
        <div className="ml-auto flex items-center gap-2">
          <OpsBadge variant="live">Live GPS</OpsBadge>
          <OpsBadge variant="sim">Modelled</OpsBadge>
        </div>
      </OpsStatStrip>
    }
  >
    <OpsStack>
      <OpsAlert tone="warning">
        Showing the last known data — the live feed did not respond (upstream timeout after 8s).
      </OpsAlert>

      <OpsSection
        title="Fleet status"
        description="Every vehicle reporting to this control room in the last five minutes."
        actions={<OpsButton>Export</OpsButton>}
      >
        <OpsTableFrame>
          <table className={opsTableClass}>
            <thead>
              <tr className={opsTheadRowClass}>
                <th className={opsThClass}>Registration</th>
                <th className={opsThClass}>Route</th>
                <th className={opsThClass}>Depot</th>
                <th className={opsThClass}>Speed</th>
                <th className={opsThClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[0]} className={opsTrClass}>
                  <td className={cellMono}>{row[0]}</td>
                  <td className={opsTdMutedClass}>{row[1]}</td>
                  <td className={opsTdMutedClass}>{row[2]}</td>
                  <td className={opsTdNumericClass}>{row[3]} km/h</td>
                  <td className={opsTdClass}>
                    <OpsBadge variant={row[4] === 'Live' ? 'live' : 'sim'}>{row[4]}</OpsBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </OpsTableFrame>
      </OpsSection>

      <OpsGrid columns={2}>
        <OpsPanel title="Issue command" description="Reaches the driver's console immediately.">
          <div className="space-y-4">
            <OpsField label="Action" htmlFor="p-action" required>
              <OpsSelect id="p-action" defaultValue="hold">
                <option value="hold">Hold at stop</option>
                <option value="skip">Skip stop</option>
              </OpsSelect>
            </OpsField>
            <OpsField label="Vehicle" htmlFor="p-vehicle" hint="Registration or fleet number.">
              <OpsInput id="p-vehicle" placeholder="UP25FT4823" />
            </OpsField>
            <OpsToolbar>
              <OpsButton variant="primary">Send</OpsButton>
              <OpsButton>Preview</OpsButton>
              <OpsButton variant="danger">Cancel all</OpsButton>
              <OpsButton variant="quiet">Reset</OpsButton>
            </OpsToolbar>
          </div>
        </OpsPanel>

        <OpsPanel title="Route 41 · up" tone="accent">
          <div className="grid grid-cols-2 gap-4">
            <OpsReadout label="Headway CV" value="0.42" tone="warn" />
            <OpsReadout label="Excess wait" value="3.1 min" tone="critical" />
            <OpsReadout label="Recovery rate" value="87%" tone="good" />
            <OpsReadout label="Vehicles" value="14" />
          </div>
          <div className="mt-4">
            <OpsEmptyState>No incidents open on this corridor.</OpsEmptyState>
          </div>
        </OpsPanel>
      </OpsGrid>

      <OpsSection title="Alerts">
        <div className="space-y-3">
          <OpsAlert tone="info">Bunching detection runs every 60 seconds.</OpsAlert>
          <OpsAlert tone="success">Command acknowledged by driver at 14:02.</OpsAlert>
          <OpsAlert tone="error">
            Live data is unavailable — nothing is shown below: this is an outage, not an empty fleet.
          </OpsAlert>
        </div>
      </OpsSection>
    </OpsStack>
  </OpsShell>
);

/**
 * The layout a map needs: nothing on the page scrolls, and the map frame is
 * handed a real height by a flex chain that is allowed to shrink.
 */
const map = (
  <OpsShell
    title="Live Fleet"
    email="control.room@upsrtc.olympuss.local"
    role="control_room"
    variant="full"
    statusStrip={
      <OpsStatStrip>
        <OpsStat label="Live vehicles" value="9,170" tone="accent" />
        <OpsStat label="In view" value="1,204" />
        <OpsStat label="Bunched pairs" value="12" tone="warn" />
      </OpsStatStrip>
    }
  >
    <OpsMapFrame
      overlay={
        <div className="flex justify-end p-3">
          <div className="pointer-events-auto">
            <OpsPanel title="Layers" className="w-56">
              <p className="text-xs text-ops-muted">Overlay panels float here.</p>
            </OpsPanel>
          </div>
        </div>
      }
    >
      <div className="flex h-full w-full items-center justify-center bg-hud-grid bg-hud-grid">
        <p className="ops-label">Map canvas</p>
      </div>
    </OpsMapFrame>
  </OpsShell>
);

process.stdout.write(renderToStaticMarkup(process.argv[2] === 'map' ? map : wide));
