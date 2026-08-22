# Experiment specs

Each file here is one reproducible evaluation. `pnpm sim:run --config
experiments/<name>.json --out experiments/runs/<name>` writes the spec back
out alongside its results, so a run stays interpretable after the file is
edited.

See `docs/CONTROLLER_EVALUATION.md` for what the two halves of a report mean
and what the harness does not model.

`runs/` is gitignored — results are large, machine-generated, and derived from
the spec plus the code at that commit.
