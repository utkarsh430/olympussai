-- `recommendations` gains an index on `created_at` alone.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY, AND WHY ONLY NOW
-- ============================================================================
--
-- The table has carried `recommendations_route_direction_created_idx
-- (route_direction_id, created_at desc)` since the core data model, which is
-- the right index for every read that existed until now: they all started by
-- naming a corridor. `findLatestRecommendation` does, and it was the only
-- reader in the service.
--
-- The standing-proposal feed asks a question no reader had asked before -
-- "when did the automatic controller last write ANY row, on any corridor?" -
-- and that one is answered by `max(created_at)` over the whole table. It is
-- the field that keeps an empty feed from reading as an all-clear: null means
-- the cycle has never written, and a timestamp older than the feed's window
-- means it has stopped. So it is read on every page load of a surface an
-- operator leaves open, and it must not degrade into a sequential scan.
--
-- Nothing prunes this table. `scheduler/retention.ts` READS it - to keep an
-- incident that a recommendation points at from being deleted out from under
-- an audit record - and deletes nothing from it. `recommendations` therefore
-- grows for as long as the decision cycle runs, which makes the scan this
-- index removes get slower forever rather than staying small.
--
-- The windowed per-corridor read beside it is deliberately shaped as
-- `distinct on (route_direction_id)` so it is answered by the EXISTING index
-- and needs nothing new; see src/db/recommendations.ts#listStandingRecommendations.
--
-- Nothing here changes what a row authorizes. Every recommendation is still
-- `status = 'proposed'` and still reaches a bus only through a dispatcher
-- approval and POST /v1/commands.

begin;

create index if not exists recommendations_created_at_idx
  on recommendations (created_at desc);

commit;
