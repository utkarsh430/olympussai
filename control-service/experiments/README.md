# Experiment specs

Each file here is one reproducible evaluation. `pnpm sim:run --config
experiments/<name>.json --out experiments/runs/<name>` writes the spec back
out alongside its results, so a run stays interpretable after the file is
edited.

See `docs/CONTROLLER_EVALUATION.md` for what the two halves of a report mean
and what the harness does not model.

`runs/` is gitignored — results are large, machine-generated, and derived from
the spec plus the code at that commit.

## The two that answer "does the synthetic approach hold"

`real-corridors.json` runs the deployed laws on every ACTIVE route-direction
that is calibrated and inside the controllable band at this run's own assumed
running-time spread, at demand sized per corridor (`evaluation/demand.ts`).
`presets.json` runs the three fleet-trial shapes through the SAME harness on
the SAME seeds and scenarios, each under its own published inputs, so the two
outputs are directly comparable. Findings in
`docs/REAL_CORRIDOR_EVALUATION.md`.

`requireLivePair: false` is deliberate: the live-vehicle half of an eligibility
verdict is a 300-second snapshot of `vehicle_states` and moves minute to
minute, while the simulator dispatches its own fleet. The corridor-intrinsic
question - calibrated and in band - is the reproducible one. Either way the run
writes the route-direction ids it resolved to back into its own `spec.json`.
