import { stripCue, type StripMetrics } from './scrollStrip';

/**
 * Whether a table frame should show its right-edge cue (a fade plus the words "more
 * columns"): only while columns are hidden to the right, and never at the end of the
 * scroll. Same edge tolerance as the navigation strips, so sub-pixel rounding at the
 * very end does not leave the cue showing.
 */
export function hasColumnsToTheRight(metrics: StripMetrics): boolean {
  return stripCue(metrics).after;
}
