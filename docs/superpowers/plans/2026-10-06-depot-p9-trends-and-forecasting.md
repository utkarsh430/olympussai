# Depot Management P9 — Trends and Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every headline figure shows where it has been and where it is heading: a trend line beside the live value, and a short forecast with an honest uncertainty band for the network and for each depot.

**Architecture:** Trends read from the `HistoryRepository` (modelled today; a database-backed adapter later, with no change to callers). Forecasts are pure functions over a daily series: a seasonal-naive baseline and Holt-Winters additive smoothing with a weekly season, chosen per series by backtest error, with a prediction band from the backtest residuals. Because the history is modelled, every trend and forecast is labelled MODELLED; the code path is identical for real history.

**Tech Stack:** TypeScript, vitest, Next.js route handlers, Recharts through the `dataviz` skill, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-06-depot-management-design.md`, `docs/superpowers/specs/2026-10-06-depot-ui-design-brief.md`. Builds on P4 (history repository and API) and P1–P3 pages.

## Global Constraints

- All earlier global constraints still bind.
- A trend line or forecast is never drawn inside the same visual element as a live numeral without a MODELLED tag on the line itself; the live value is the last point and is drawn distinctly from the modelled points before it.
- A forecast always shows its band and its horizon, and states the method and the backtest error in words. No forecast is shown from fewer than `MIN_HISTORY_DAYS = 28` points.
- Forecast values respect each metric's valid range (rates 0–1, index 0–100, counts non-negative integers); bands are clipped to the range, never beyond it.
- Pure forecasting functions: no clock, no randomness, no mutation; identical output for identical input.
- Sparklines are decorative summaries: each has a text equivalent ("up 2.1 points over 30 days") and the full chart is one click away.

## Review Focus

1. A constant series (zero variance): forecast equals the constant with a zero-width band, never `NaN`. Task 1.
2. A series shorter than two full seasons: the seasonal method is not offered; the baseline is used and the page says why. Task 1.
3. A forecast that would leave the valid range: clipped, with the band clipped too. Task 1.
4. A backtest in which the "better" method wins by noise: ties and near-ties resolve deterministically to the simpler method. Task 1.
5. A reader mistaking a modelled trend for a measured one: every chart title, legend entry and tooltip carries the tag. Tasks 3 and 4.

---

### Task 1: Forecasting functions

**Files:** create `src/lib/depot/forecast/types.ts`, `forecast/seasonalNaive.ts`, `forecast/holtWinters.ts`, `forecast/backtest.ts`, `forecast/forecast.ts`, `forecast/config.ts`; tests `src/tests/unit/depot-forecast.test.ts`, `depot-forecast-backtest.test.ts`.

```ts
export type ForecastMethod = 'seasonal_naive' | 'holt_winters';
export interface ForecastPoint { readonly date: string; readonly value: number; readonly low: number; readonly high: number }
export interface Forecast { readonly method: ForecastMethod; readonly horizonDays: number;
  readonly points: readonly ForecastPoint[]; readonly backtestMae: number; readonly historyDays: number }
export type ForecastResult = { readonly status: 'ok'; readonly forecast: Forecast }
  | { readonly status: 'insufficient_history'; readonly historyDays: number; readonly required: number };
export const SEASON_DAYS = 7; export const MIN_HISTORY_DAYS = 28; export const DEFAULT_HORIZON_DAYS = 14;
export function forecastSeries(series: readonly SeriesPoint[], metric: MetricKey, horizonDays?: number): ForecastResult;
```

Backtest: rolling-origin over the last four weeks, mean absolute error per method; Holt-Winters is chosen only when its error is lower by more than `METHOD_MARGIN = 5%`. The band is the forecast plus and minus the 80th-percentile absolute backtest residual, widened with the horizon by a stated factor. Holt-Winters parameters come from a small fixed grid, the best by backtest error, ties to the smallest parameters.

- [ ] Commits `test: specify the forecasting baseline`, `feat: add seasonal-naive forecasting`, `test: specify Holt-Winters and method choice`, `feat: add Holt-Winters forecasting with backtest selection`.

### Task 2: Trend summaries

**Files:** create `src/lib/depot/forecast/trend.ts`; test `src/tests/unit/depot-trend.test.ts`.

`summariseTrend(series, metric)`: change over 7 and 30 days in the metric's own unit, the direction as a word with a dead-band so noise reads as "steady", whether higher is better for the metric, and the sentence for the text equivalent.

- [ ] Commits `test: specify trend summaries`, `feat: summarise a series as a trend`.

### Task 3: Forecast API and shared chart components

**Files:** create `src/lib/depot/live/forecastView.ts`, `src/app/api/upsrtc/depot/forecast/route.ts` (same query shape and validation as the history route plus `horizon` 7–28), `src/hooks/useDepotForecast.ts`, `src/components/depot/shared/Sparkline.tsx`, `TrendChart.tsx` (history, the live point, the forecast and its band, with a legend in words and a data table alternative).

- [ ] Commits `test: specify the forecast view`, `feat: add depot forecast API`, `feat: add sparkline and trend chart`.

### Task 4: Trends on existing pages and a forecast page

**Files:** modify the network KPI band, the league table (a sparkline column), the depot cockpit (trend beside each state share); create `/project/depots/trends` (network) and `d/[depotId]/trends` (depot): a metric chooser, the trend chart, the forecast with its method and error stated, and the availability forecast for the fleet-distribution requirement.

- [ ] Commits one per page change, then `feat: add trends and forecast pages`.

### Task 5: End-to-end and documentation

- e2e: forecast API 401 and 400; trends pages render a chart or the insufficient-history statement; every chart carries the MODELLED tag; no banned wording; no sideways scroll.
- Docs: README, `docs/LIVE_VS_PREDICTED.md` (the forecasting methods, the selection rule, what changes when real history replaces the modelled series), `docs/ARCHITECTURE.md` (the history seam and the database phase that follows).

- [ ] Commits `test: cover trends and forecasts end to end`, `docs: describe trends and forecasting`.

## Phase gate

1. `npm run typecheck && npm run lint && npm run test && npm run build`.
2. Both e2e specs on `http://localhost:3000`.
3. The pages walked in a browser at 1440, 1024 and 800.
4. Whole-phase code review; design critique; findings fixed or recorded.
