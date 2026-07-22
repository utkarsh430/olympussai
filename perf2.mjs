import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await p.waitForSelector('[data-testid="fleet-bus-row"]', { timeout: 60000 });
await p.waitForTimeout(5000);

// Instrument: long tasks during the selection interaction
await p.evaluate(() => {
  window.__lt = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); });
  obs.observe({ entryTypes: ['longtask'] });
});

const t0 = Date.now();
await p.getByTestId('fleet-bus-row').nth(2).click();
const tClick = Date.now() - t0;
await p.waitForSelector('[data-testid="bus-detail-drawer"]', { state: 'attached' });
const tAttached = Date.now() - t0;
await p.waitForSelector('[data-testid="bus-detail-drawer"]', { state: 'visible' });
const tVisible = Date.now() - t0;
await p.waitForTimeout(3000);

const lt = await p.evaluate(() => window.__lt);
console.log(`click dispatched : ${tClick}ms`);
console.log(`drawer attached  : ${tAttached}ms`);
console.log(`drawer visible   : ${tVisible}ms`);
console.log(`long tasks during: [${lt.join(', ')}]ms  total=${lt.reduce((a,c)=>a+c,0)}ms`);

// Is it the zoom-triggered recluster? Measure a manual zoom with no selection.
await p.evaluate(() => { window.__lt.length = 0; });
await p.evaluate(() => { const el=document.querySelector('[aria-label="Close bus details"]'); el && el.click(); });
await p.waitForTimeout(1500);
await p.evaluate(() => { window.__lt.length = 0; });
await p.mouse.move(1000, 500);
for (let i=0;i<4;i++) { await p.mouse.wheel(0, -400); await p.waitForTimeout(500); }
await p.waitForTimeout(2500);
const lt2 = await p.evaluate(() => window.__lt);
console.log(`zoom-only longtasks: [${lt2.join(', ')}]ms  total=${lt2.reduce((a,c)=>a+c,0)}ms`);
await b.close();
