-- Predictive bunching detection: the `predicted` severity rung.
--
-- Idempotent: every statement is safe to re-run.
--
-- ============================================================================
-- WHY A NEW SEVERITY RATHER THAN A FLAG
-- ============================================================================
--
-- Detection until now has been entirely reactive. `bunching_incidents` rows
-- are opened when a leader/follower pair's forward headway has ALREADY sat
-- under a threshold for k consecutive samples. By that point the gap has
-- collapsed: the follower is already absorbing the load the leader left, and
-- the cheap correction - a short hold, early, at a stop the bus was going to
-- serve anyway - is gone. What is left is a long hold that costs punctuality.
--
-- Bunching is an unstable equilibrium (h_{s+1} ~= (1 + beta_h) * h_s, with the
-- eigenvalue above 1), so the deviation grows on its own and acting early is
-- worth disproportionately more than acting well. `predicted` is the rung that
-- lets the system speak before the collapse.
--
-- It is a severity rather than a separate table or a boolean column because it
-- belongs on the SAME ladder: a predicted incident that comes true must
-- escalate to `warning` and then `bunched` on the row that already exists, so
-- that the operator sees one incident with a history rather than three
-- unrelated rows about the same two buses. Every consumer that already orders,
-- filters or badges by severity keeps working, and gets the new rung for free.
--
-- ============================================================================
-- WHERE IT SITS ON THE LADDER
-- ============================================================================
--
--   predicted   gap still acceptable, but closing fast enough to breach the
--               bunched threshold inside the forecast horizon
--   warning     gap at or under warning_threshold_ratio, measured
--   bunched     gap at or under bunched_threshold_ratio, measured
--   severe      reserved; nothing opens one today
--
-- `predicted` is the only rung that is a PREDICTION rather than an
-- observation, which is why src/headway/riskForecast.ts holds it to a
-- stricter evidentiary bar than the reactive rule: a wrong prediction cannot
-- be checked by looking out of the window, so it can only erode into noise.

begin;

-- Recreate rather than ALTER: Postgres has no "add value to check
-- constraint", and dropping by name then re-adding is the idempotent form.
-- The constraint name is the one the core data model's inline `check (...)`
-- produced.
alter table bunching_incidents
  drop constraint if exists bunching_incidents_severity_check;

alter table bunching_incidents
  add constraint bunching_incidents_severity_check
  check (severity in ('predicted', 'warning', 'bunched', 'severe'));

comment on column bunching_incidents.severity is
  'Ladder: predicted < warning < bunched < severe. `predicted` is raised by the forecast tier (src/headway/riskForecast.ts) BEFORE the gap collapses - the pair is still inside tolerance but closing fast enough to breach within the horizon - and escalates in place if it comes true. The other rungs are measured observations of a gap already under threshold. Ordering lives in code at src/headway/types.ts#SEVERITY_RANK.';

-- Partial index for the network-wide alert inbox: it lists every open
-- incident across all corridors ordered by severity then recency, and without
-- this it degrades to a full scan of the table as incident volume grows. The
-- existing indexes are both keyed on route_direction_id first, which serves
-- the per-corridor console panel and not this query.
create index if not exists bunching_incidents_open_severity_idx
  on bunching_incidents (severity, started_at desc)
  where status <> 'closed';

commit;
