import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * End-to-end coverage for the UPSRTC AI Operations Copilot command centre.
 * Runs at 1920x1080 — the presentation resolution.
 */

/** Console errors we tolerate: they originate outside our application code. */
const IGNORABLE_CONSOLE = [
  'Google Maps',
  'googleapis.com',
  'maps.googleapis',
  'billing',
  'ApiTargetBlockedMapError',
  'InvalidKeyMapError',
  'RefererNotAllowed',
  'net::ERR_',
  'Failed to load resource',
  'favicon',
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORABLE_CONSOLE.some((pattern) => text.includes(pattern))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => {
    if (IGNORABLE_CONSOLE.some((pattern) => error.message.includes(pattern))) return;
    errors.push(error.message);
  });
  return errors;
}

/** Wait for the live (or fixture) fleet to populate the navigation panel. */
async function waitForFleet(page: Page): Promise<void> {
  await expect(page.getByTestId('fleet-bus-row').first()).toBeVisible({ timeout: 60_000 });
}

async function selectFirstBus(page: Page): Promise<void> {
  await waitForFleet(page);
  await page.getByTestId('fleet-bus-row').first().click();
  await expect(page.getByTestId('bus-detail-drawer')).toBeVisible({ timeout: 30_000 });
}

/**
 * The dashboard is behind enterprise authentication (Supabase Auth). Accounts
 * are admin-provisioned only (`pnpm run create-project-user`) — supply an
 * existing account's credentials via E2E_PROJECT_EMAIL / E2E_PROJECT_PASSWORD
 * when running the suite, e.g.:
 *   E2E_PROJECT_EMAIL=you@example.com E2E_PROJECT_PASSWORD=... npm run test:e2e
 * Without them the authenticated suite is skipped rather than failing.
 */
const E2E_EMAIL = process.env.E2E_PROJECT_EMAIL;
const E2E_PASSWORD = process.env.E2E_PROJECT_PASSWORD;
const E2E_ORIGIN = process.env.E2E_ORIGIN ?? 'http://127.0.0.1:3000';

test.describe('UPSRTC AI Operations Copilot', () => {
  test.skip(
    !E2E_EMAIL || !E2E_PASSWORD,
    'Set E2E_PROJECT_EMAIL and E2E_PROJECT_PASSWORD to run the authenticated dashboard e2e suite',
  );

  test.beforeEach(async ({ context }) => {
    const res = await context.request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json', Origin: E2E_ORIGIN },
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
    });
    if (!res.ok()) throw new Error(`E2E login failed (${res.status()})`);
  });

  test('1. command centre loads with identity and connection status', async ({ page }) => {
    await page.goto('/project/upsrtc');

    // The command bar carries the Olympuss project identity (the former
    // product heading + subtitle were removed).
    await expect(page.getByText('Olympuss AI')).toBeVisible();
    await expect(page.getByText('Project Environment')).toBeVisible();
    await expect(page.getByText(/CONNECTED|FIXTURE|STALE CACHE|DEGRADED|UNAVAILABLE/).first()).toBeVisible();
  });

  test('2. live or fixture buses appear in the fleet panel and on the counter', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await waitForFleet(page);

    const rows = page.getByTestId('fleet-bus-row');
    expect(await rows.count()).toBeGreaterThan(0);

    // Registration numbers follow the real UPSRTC plate format.
    await expect(rows.first()).toContainText(/[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}/);
    await expect(page.getByTestId('visible-count')).toBeVisible();
  });

  test('3. selecting a bus opens its detail panel with live data', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    const drawer = page.getByTestId('bus-detail-drawer');
    await expect(drawer.getByText('LIVE UPSRTC DATA')).toBeVisible();
    await expect(drawer.getByText('Live UPSRTC GPS')).toBeVisible();
    await expect(drawer.getByText('Coordinates')).toBeVisible();
    await expect(drawer.getByText('Data Quality')).toBeVisible();
  });

  test('4. schedule is requested only after a bus is selected', async ({ page }) => {
    const scheduleRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/upsrtc/schedule')) scheduleRequests.push(request.url());
    });

    await page.goto('/project/upsrtc');
    await waitForFleet(page);

    // Nothing should have asked for a schedule during initial fleet load.
    expect(scheduleRequests).toHaveLength(0);

    await page.getByTestId('fleet-bus-row').first().click();
    await expect(page.getByTestId('bus-detail-drawer')).toBeVisible();

    await expect.poll(() => scheduleRequests.length, { timeout: 30_000 }).toBeGreaterThan(0);

    // Exactly one vehicle is queried — never the whole fleet.
    expect(scheduleRequests.length).toBeLessThan(3);
    expect(scheduleRequests[0]).toContain('regNum=');
  });

  test('5. bunching analysis opens with projected companion buses', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    await page.getByTestId('analysis-bunching').click();

    const stage = page.getByTestId('scenario-stage');
    await expect(stage).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('bunching-stage')).toBeVisible();
    await expect(stage.getByText('BUNCHING ANALYSIS').first()).toBeVisible();
    await expect(stage.getByText('SELECTED BUS')).toBeVisible();
    await expect(stage.getByText('BUS AHEAD')).toBeVisible();
    await expect(stage.getByText('BUS BEHIND')).toBeVisible();
  });

  test('6. corridor analysis opens with route comparison', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    await page.getByTestId('analysis-traffic').click();

    await expect(page.getByTestId('traffic-stage')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('CURRENT ROUTE')).toBeVisible();
    await expect(page.getByText('SUGGESTED ALTERNATIVE')).toBeVisible();
    await expect(
      page.getByText(/Route diversion and driver instructions require authorized dispatcher approval/),
    ).toBeVisible();
  });

  test('7. incident response opens with assistance candidates', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    await page.getByTestId('analysis-breakdown').click();

    await expect(page.getByTestId('breakdown-stage')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('RESCUE-01').first()).toBeVisible();
    await expect(page.getByText('Passengers onboard')).toBeVisible();
    await expect(page.getByText('Breakdown detected')).toBeVisible();
  });

  test('8. demand analysis opens with a working time slider', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    await page.getByTestId('analysis-demand').click();

    await expect(page.getByTestId('demand-stage')).toBeVisible({ timeout: 20_000 });
    const slider = page.getByTestId('demand-time-slider');
    await expect(slider).toBeVisible();

    // Moving the slider must visibly change the demonstration.
    const before = await page.getByTestId('demand-stage').innerText();
    await slider.getByRole('button', { name: '5 PM' }).click();
    await expect
      .poll(async () => page.getByTestId('demand-stage').innerText(), { timeout: 10_000 })
      .not.toBe(before);
  });

  test('9. driver message sends and receives acknowledgement', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    await page.getByTestId('analysis-contact').click();

    const modal = page.getByTestId('driver-message-modal');
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByText('NO DRIVER IS CONTACTED FROM THIS PROTOTYPE', { exact: true })).toBeVisible();

    // Bilingual draft is present.
    await expect(modal.getByText('English message')).toBeVisible();
    await expect(modal.getByText(/Hindi message/)).toBeVisible();

    await page.getByTestId('send-driver-message').click();

    await expect(page.getByTestId('message-status')).toBeVisible();
    await expect
      .poll(async () => page.getByTestId('message-status').innerText(), { timeout: 30_000 })
      .toMatch(/acknowledged/i);
  });

  test('10. voice call connects and ends cleanly', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    await page.getByTestId('analysis-bunching').click();
    await expect(page.getByTestId('scenario-stage')).toBeVisible();

    await page.getByTestId('copilot-action-voip').click();

    const overlay = page.getByTestId('voip-overlay');
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    await expect(overlay.getByText('NO EXTERNAL CALL IS PLACED FROM THIS PROTOTYPE')).toBeVisible();

    await expect
      .poll(async () => page.getByTestId('call-status').innerText(), { timeout: 20_000 })
      .toMatch(/Connected/i);

    await page.getByTestId('end-call').click();
    await expect
      .poll(async () => page.getByTestId('call-status').innerText(), { timeout: 15_000 })
      .toMatch(/ended/i);
  });

  test('11. pitch mode starts, advances and exits', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await waitForFleet(page);

    await page.getByTestId('start-pitch-mode-strip').click();

    const overlay = page.getByTestId('pitch-mode-overlay');
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pitch-caption')).toContainText(
      'Live visibility across the UPSRTC fleet',
    );

    // Pause holds the caption steady.
    await page.getByTestId('pitch-pause').click();
    await expect(page.getByTestId('pitch-pause')).toContainText(/Resume/i);

    await page.getByTestId('exit-pitch-mode').click();
    await expect(overlay).not.toBeVisible({ timeout: 15_000 });
  });

  test('12. live-data and predictive markers remain visible together', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await waitForFleet(page);

    // The top bar always distinguishes live data from the predictive layer.
    await expect(page.getByText(/LIVE UPSRTC GPS|UPSRTC FIXTURE FALLBACK|UPSTREAM UNAVAILABLE/).first()).toBeVisible();
    await expect(page.getByText('Predictive Engine Active')).toBeVisible();

    await selectFirstBus(page);
    await page.getByTestId('analysis-breakdown').click();
    await expect(page.getByTestId('breakdown-stage')).toBeVisible({ timeout: 20_000 });

    // Simulation labelling survives while a scenario is on screen.
    await expect(page.getByTestId('scenario-stage').getByText('INCIDENT RESPONSE').first()).toBeVisible();
    await expect(page.getByText(/LIVE UPSRTC GPS|UPSRTC FIXTURE FALLBACK|UPSTREAM UNAVAILABLE/).first()).toBeVisible();
  });

  test('13. footer disclaimer is always accessible and expandable', async ({ page }) => {
    await page.goto('/project/upsrtc');

    const footer = page.getByTestId('footer-disclaimer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/Vehicle positions and schedules are live UPSRTC data/);

    await footer.getByRole('button').click();
    await expect(footer).toContainText(/No driver is contacted/);
    await expect(footer).toContainText(/No operational instruction is executed automatically/);
  });

  test('14. no unexpected JavaScript console errors occur during a full walkthrough', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    for (const testId of ['analysis-bunching', 'analysis-traffic', 'analysis-breakdown', 'analysis-demand']) {
      await page.getByTestId(testId).click();
      await expect(page.getByTestId('scenario-stage')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(700);
    }

    await page.getByTestId('close-scenario').click();
    await page.waitForTimeout(400);

    expect(errors, `Unexpected console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('15. scenario lab drawer opens, and the header exposes Bunching', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await waitForFleet(page);

    await page.getByRole('button', { name: /Scenario Lab/i }).click();
    await expect(page.getByTestId('scenario-lab')).toBeVisible();
    await expect(page.getByTestId('reset-demonstration')).toBeVisible();
    await page.keyboard.press('Escape');

    // The Audit and Diagnostics header controls were replaced by Bunching. The
    // drawers themselves remain in the application and keep recording (see the
    // audit-trail test below); they simply no longer have a header trigger.
    await expect(page.getByRole('button', { name: /^Audit$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Diagnostics$/i })).toHaveCount(0);
    await expect(page.getByTestId('open-bunching')).toBeVisible();
  });

  test('16. impact dashboard shows projected figures', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await waitForFleet(page);

    await page.getByTestId('open-impact').click();

    const dashboard = page.getByTestId('impact-dashboard');
    await expect(dashboard).toBeVisible({ timeout: 15_000 });
    await expect(dashboard.getByText('PROJECTED', { exact: true })).toBeVisible();
    await expect(dashboard.getByText(/Modelled estimates/)).toBeVisible();
    await expect(dashboard.getByText('Bunching incidents', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dashboard).not.toBeVisible({ timeout: 10_000 });
  });

  test('17. audit trail records the operator walkthrough', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);
    await page.getByTestId('analysis-bunching').click();
    await expect(page.getByTestId('scenario-stage')).toBeVisible({ timeout: 20_000 });

    // Asserted against the persisted trail rather than the drawer: the drawer no
    // longer has a header trigger, but audit recording is unchanged.
    const events = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('upsrtc-copilot-audit-v1') ?? '[]'),
    );

    const types = (events as Array<{ type: string; simulated: boolean }>).map(
      (event) => event.type,
    );
    expect(types).toContain('bus-selected');
    expect(types).toContain('scenario-launched');
    // Live vs simulated provenance is preserved per event.
    const simulatedFlags = (events as Array<{ simulated: boolean }>).map(
      (event) => event.simulated,
    );
    expect(simulatedFlags).toContain(true);
    expect(simulatedFlags).toContain(false);
  });

  test('18. alert centre is seeded with five alerts anchored to real vehicles', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await expect(page.getByTestId('alert-centre')).toBeVisible();

    const alerts = page.getByTestId('alert-item');
    await expect(alerts.first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => alerts.count(), { timeout: 30_000 }).toBe(5);

    // Provenance marker is present, and exactly once — not on every card.
    await expect(page.getByTestId('alert-centre').getByText('Predictive', { exact: true })).toBeVisible();

    // Each alert carries a real UPSRTC registration.
    await expect(alerts.first()).toContainText(/[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}/);

    // No toast on load — the seeded batch populates the board silently.
    await expect(page.getByTestId('alert-toast')).toHaveCount(0);
  });

  test('19. opening an alert selects its vehicle and opens the analysis', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await expect(page.getByTestId('alert-item').first()).toBeVisible({ timeout: 60_000 });

    const registration = (await page.getByTestId('alert-item').first().innerText()).match(
      /[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}/,
    )?.[0];
    expect(registration).toBeTruthy();

    await page.getByTestId('alert-item').first().click();

    await expect(page.getByTestId('bus-detail-drawer')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('bus-detail-drawer')).toContainText(registration as string);
    await expect(page.getByTestId('scenario-stage')).toBeVisible({ timeout: 20_000 });
  });

  test('20. a new alert is raised on the stream interval', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await expect(page.getByTestId('alert-item').first()).toBeVisible({ timeout: 60_000 });
    const initial = await page.getByTestId('alert-item').count();

    // The stream raises one alert every 30s; allow headroom.
    await expect(page.getByTestId('alert-toast').first()).toBeVisible({ timeout: 50_000 });
    await expect.poll(() => page.getByTestId('alert-item').count(), { timeout: 20_000 }).toBeGreaterThan(initial);
  });

  test('21. no "simulated" or "demonstrate" wording remains anywhere in the interface', async ({
    page,
  }) => {
    await page.goto('/project/upsrtc');
    await expect(page.getByTestId('alert-item').first()).toBeVisible({ timeout: 60_000 });

    async function assertClean(where: string) {
      const body = await page.locator('body').innerText();
      expect(body, `"simulated" leaked into: ${where}`).not.toMatch(/simulated/i);
      expect(body, `"demonstrate" leaked into: ${where}`).not.toMatch(/demonstrate/i);
    }

    await assertClean('command centre');

    await page.getByTestId('fleet-bus-row').first().click();
    await expect(page.getByTestId('bus-detail-drawer')).toBeVisible();
    await assertClean('vehicle drawer');

    // Every analysis view, not just the first — this is where wording regressed before.
    for (const testId of [
      'analysis-bunching',
      'analysis-traffic',
      'analysis-breakdown',
      'analysis-demand',
    ]) {
      await page.getByTestId(testId).click();
      await expect(page.getByTestId('scenario-stage')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);
      await assertClean(testId);
    }

    // And every auxiliary surface.
    await page.getByRole('button', { name: /Scenario Lab/i }).click();
    await expect(page.getByTestId('scenario-lab')).toBeVisible();
    await assertClean('scenario lab');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Diagnostics/i }).click();
    await expect(page.getByTestId('diagnostics-drawer')).toBeVisible();
    await assertClean('diagnostics');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Audit/i }).click();
    await expect(page.getByTestId('audit-drawer')).toBeVisible();
    await assertClean('audit trail');
    await page.keyboard.press('Escape');

    await page.getByTestId('open-impact').click();
    await expect(page.getByTestId('impact-dashboard')).toBeVisible();
    await assertClean('impact dashboard');
  });

  test('22. fleet distribution opens from the command bar without a prior selection', async ({
    page,
  }) => {
    await page.goto('/project/upsrtc');
    await expect(page.getByTestId('alert-item').first()).toBeVisible({ timeout: 60_000 });

    // No vehicle selected yet — the view must anchor one itself.
    await expect(page.getByTestId('bus-detail-drawer')).toHaveCount(0);

    await page.getByTestId('open-fleet-distribution').click();

    await expect(page.getByTestId('demand-stage')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('demand-time-slider')).toBeVisible();
    await expect(page.getByTestId('demand-stage').getByText('Redistribution plan')).toBeVisible();
  });

  test('23. alert stream carries exactly one vehicle-fault alert', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await expect(page.getByTestId('alert-item').first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => page.getByTestId('alert-item').count(), { timeout: 30_000 }).toBe(5);

    // Count by kind attribute — titles and summaries share wording, so prose
    // matching double-counts.
    const kinds = await page
      .getByTestId('alert-item')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-alert-kind')));

    expect(kinds.filter((k) => k === 'breakdown')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'bunching' || k === 'traffic')).toHaveLength(4);
    // Demand is reviewed from Fleet Distribution, never streamed as an alert.
    expect(kinds).not.toContain('demand');
  });

  test('24. keyboard escape closes the bus detail drawer', async ({ page }) => {
    await page.goto('/project/upsrtc');
    await selectFirstBus(page);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bus-detail-drawer')).not.toBeVisible({ timeout: 10_000 });
  });

  // REWRITTEN when /project/bunching stopped being a scripted scenario on a
  // fabricated corridor and became the control service's own simulator run
  // over a real seeded route-direction (see
  // src/components/bunching/BunchingSimulator.tsx). The old assertions were
  // about panes, iterations and a hand-tuned recovery curve, none of which
  // exist any more.
  //
  // WHAT THIS HOLDS NOW, and why each half is worth an end-to-end test:
  //
  //   1. THE REAL ROUTE RENDERS. Typecheck, lint, unit tests and the build
  //      all pass for a page that returns 500 on every request - a Server
  //      Component reaching a client value is the worked example. Opening
  //      the actual URL is the only thing that catches it.
  //   2. IT DECLARES ITSELF A SIMULATION before anything is run, because
  //      that claim is the entire justification for the page existing.
  //   3. IT IS HONEST ABOUT COVERAGE on whatever network it is pointed at.
  //      CI runs against a freshly-migrated control-service database with no
  //      seeded corridors, so the expected outcome there is the page saying
  //      it has nothing calibrated to rehearse - which is exactly the
  //      behaviour that must not silently become "run it anyway".
  test('25. Bunching opens the control rehearsal, declares itself a simulation, and is honest about coverage', async ({
    page,
  }) => {
    await page.goto('/project/upsrtc');
    await waitForFleet(page);
    await page.getByTestId('open-bunching').click();

    await expect(page).toHaveURL(/\/project\/bunching$/);

    // Console collection starts HERE, after the navigation, rather than at
    // the top of the test. Not to be lenient - test 14 above still holds the
    // command centre to a clean console across a full walkthrough, which is
    // where that page's own noise belongs. It is because this test is about
    // the rehearsal surface, and an intermittent hydration warning from the
    // command centre's copilot panel (observed once during a dev-mode run,
    // in a component this work does not touch) would make it fail for a
    // reason it is not testing.
    const errors = collectConsoleErrors(page);
    await expect(page.getByRole('heading', { name: /Control strategy rehearsal/i })).toBeVisible();

    // The page renders rather than erroring, and says what it is before any
    // run has happened.
    await expect(page.getByText(/Every bus on this page is invented/i)).toBeVisible();
    await expect(page.getByText(/nothing here can issue an instruction/i)).toBeVisible();

    // Coverage is stated either way. On a seeded network the picker offers
    // the calibrated corridors; on an unseeded one the page says plainly
    // that there is nothing to simulate against, and never offers a run
    // over a corridor with no measured target headway.
    const corridorPicker = page.getByLabel('Corridor', { exact: true });
    const optionCount = await corridorPicker.locator('option').count();

    if (optionCount === 0) {
      await expect(
        page.getByText(/No corridor in this network has a measured target headway/i),
      ).toBeVisible();
    } else {
      await expect(page.getByText(/have a measured target headway/i)).toBeVisible();

      // Run one, and check the two arms are both reported. Both are
      // simulated over the same corridor, conditions and seed, so the
      // comparison a planner reads means something.
      await page.getByRole('button', { name: /Run the rehearsal/i }).click();
      await expect(page.getByRole('button', { name: /With control laws/i })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByRole('button', { name: /^No control$/i })).toBeVisible();

      // The provenance manifest is one click away and separates what was
      // measured from what this simulator invented.
      await page.getByRole('tab', { name: /What is real/i }).click();
      await expect(page.getByText(/inputs come from the seeded network/i)).toBeVisible();
      await expect(page.getByText(/What this does not rehearse/i)).toBeVisible();
    }

    expect(errors, `Unexpected console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
