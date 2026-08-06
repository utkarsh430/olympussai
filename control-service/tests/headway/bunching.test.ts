import { describe, expect, it } from "vitest";
import { evaluateBunchingRule } from "../../src/headway/bunching.js";

const REQUIRED_SAMPLES = 3;
const BUNCHED_RATIO = 0.25;
const WARNING_RATIO = 0.5;

describe("evaluateBunchingRule", () => {
  it("does not flag anything until there are enough samples", () => {
    const result = evaluateBunchingRule([0.1, 0.1], REQUIRED_SAMPLES, BUNCHED_RATIO, WARNING_RATIO, false);
    expect(result.severity).toBeNull();
    expect(result.recovered).toBe(false);
    expect(result.ratio).toBe(0.1);
  });

  it("flags 'bunched' when the last N consecutive samples are all at/below the bunched threshold", () => {
    const result = evaluateBunchingRule([0.2, 0.15, 0.1], REQUIRED_SAMPLES, BUNCHED_RATIO, WARNING_RATIO, false);
    expect(result.severity).toBe("bunched");
  });

  it("flags 'warning' when samples are below the warning threshold but not the bunched one", () => {
    const result = evaluateBunchingRule([0.45, 0.4, 0.35], REQUIRED_SAMPLES, BUNCHED_RATIO, WARNING_RATIO, false);
    expect(result.severity).toBe("warning");
  });

  it("does not flag when samples are mixed (not all consecutive samples breach the threshold)", () => {
    const result = evaluateBunchingRule([0.9, 0.1, 0.1], REQUIRED_SAMPLES, BUNCHED_RATIO, WARNING_RATIO, false);
    expect(result.severity).toBeNull();
  });

  it("only inspects the most recent requiredSamples window, ignoring older history", () => {
    // Newest-first: last 3 are all healthy even though older samples were bunched.
    const result = evaluateBunchingRule(
      [0.9, 0.95, 1.0, 0.1, 0.1, 0.1],
      REQUIRED_SAMPLES,
      BUNCHED_RATIO,
      WARNING_RATIO,
      false
    );
    expect(result.severity).toBeNull();
  });

  it("reports recovered only when an incident is already open and the window is fully healthy", () => {
    const withoutOpenIncident = evaluateBunchingRule([0.9, 0.95, 1.0], REQUIRED_SAMPLES, BUNCHED_RATIO, WARNING_RATIO, false);
    expect(withoutOpenIncident.recovered).toBe(false);

    const withOpenIncident = evaluateBunchingRule([0.9, 0.95, 1.0], REQUIRED_SAMPLES, BUNCHED_RATIO, WARNING_RATIO, true);
    expect(withOpenIncident.recovered).toBe(true);
  });

  it("does not report recovered when the open incident's window is still mixed", () => {
    const result = evaluateBunchingRule([0.9, 0.1, 0.95], REQUIRED_SAMPLES, BUNCHED_RATIO, WARNING_RATIO, true);
    expect(result.recovered).toBe(false);
  });

  it("treats requiredSamples <= 0 as never enough evidence to flag", () => {
    const result = evaluateBunchingRule([0.1, 0.1], 0, BUNCHED_RATIO, WARNING_RATIO, false);
    expect(result.severity).toBeNull();
  });
});
