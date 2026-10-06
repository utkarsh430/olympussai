# w2-D fix round 2 report

1. Transfer verdict (facts/transfer.ts): `verdict` takes `withinMaximum`; when balances support the move but the distance exceeds `rebalanceParams.maxTransferKm`, a distinct sentence says the balances alone would suit it but the distance is beyond the planner's maximum. Test pins that sentence and the exact-maximum edge.
2. Singular counts: `countPhrase(n, one, many)` in facts/format.ts. Applied to depot fleet paragraph (on road, dark, off road), yard support ("falls/fall"), network opening (reporting, running, no signal, maintenance) and the vehicle-only exception sentence. Searched facts/ and facts/answers/; no other count-subject verb sentences. Tests cover one and many for each.
3. LEADING_WHO: a leading who/whom/whose is refused only when the question has no RANKING cue. "Who has the most dark buses?" routes to rankDepots (dark, top). Deviation: the brief also suggested a depot cue, but existing tests require "Who owns Kanpur", "Whose depot is Kanpur" to stay refused, so only the ranking cue is used.
4. Ambiguous depot name: new helper `namesAmbiguousDepot` (word or word pair that prefixes more than one depot name); both networkSummary returns are skipped when it is true, so "Meerut fleet status" returns unsupported. Tests added.

Tests: depot-copilot suites 649 pass; tsc clean; lint clean; full `npm run test`: 1751 tests pass, 8 files fail to load because the `server-only` module cannot be resolved in this worktree (environmental, unrelated files).

Concerns: unsupported answer has no "matches more than one depot" wording (the query has no message field; outside permitted files). Depot-cue for "who" not implemented, see above.
