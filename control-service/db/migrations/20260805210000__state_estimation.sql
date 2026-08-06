-- Control service -- live route-direction state estimation support
--
-- Adds the columns the state estimator (control-service/src/state-estimation)
-- needs on top of the core data model
-- (20260805190000__core_data_model.sql), which this file does not edit --
-- per the standing rule against hand-editing a shipped migration, this is
-- an additive follow-up.
--
-- What's added and why:
--   route_directions.is_loop               -- distinguishes a looping route
--                                              (terminal wrap-around leader/
--                                              follower ordering applies)
--                                              from a linear one.
--   route_directions.corridor_offset_meters,
--   route_directions.corridor_direction_sign -- convert this route-
--                                              direction's own
--                                              distance-along-route into a
--                                              corridor-relative distance,
--                                              for ordering vehicles across
--                                              routes that share a trunk
--                                              segment (corridor_id).
--                                              Null offset means "not
--                                              surveyed yet" -- vehicles on
--                                              that route-direction are
--                                              excluded from corridor
--                                              ordering rather than ordered
--                                              against a meaningless
--                                              comparison.
--   vehicle_states.is_low_confidence        -- explicit flag alongside the
--                                              existing numeric confidence
--                                              column, so a low-confidence
--                                              estimate is never silently
--                                              treated the same as a
--                                              trusted one by a downstream
--                                              consumer that only checks
--                                              for NULL.
--   vehicle_states.kf_state, .kf_updated_at -- the Kalman filter's own
--                                              [s, v, P] state (see
--                                              src/state-estimation/kalmanFilter.ts),
--                                              persisted so a service
--                                              restart resumes smoothing
--                                              from where it left off
--                                              instead of re-converging
--                                              from a cold prior.
--   vehicle_states.stop_state_entered_at    -- when the vehicle entered its
--                                              current stop_state's
--                                              geofence/hold, so dwell
--                                              duration is derivable at
--                                              read time (now() - this)
--                                              without a separate
--                                              write-amplifying counter.
--
-- Idempotent: every statement is safe to re-run.

begin;

alter table route_directions
  add column if not exists is_loop boolean not null default false,
  add column if not exists corridor_offset_meters numeric,
  add column if not exists corridor_direction_sign smallint not null default 1
    check (corridor_direction_sign in (-1, 1));

comment on column route_directions.is_loop is
  'True when this route-direction is a physical loop (its shape returns to its own start), so leader/follower ordering wraps at total_distance_meters instead of terminating.';
comment on column route_directions.corridor_offset_meters is
  'Cumulative distance (meters) along this route-direction''s own shape at which it enters the shared corridor identified by corridor_id. Null until surveyed; vehicles on a route-direction with a null offset are excluded from corridor-level ordering.';
comment on column route_directions.corridor_direction_sign is
  '+1 if this route-direction''s distance-along-route increases in the same physical sense as the corridor''s reference direction, -1 if opposite. Used to convert a local distance into a corridor-relative one: corridor_offset_meters + corridor_direction_sign * distance_along_route_meters.';

alter table vehicle_states
  add column if not exists is_low_confidence boolean not null default false,
  add column if not exists kf_state jsonb,
  add column if not exists kf_updated_at timestamptz,
  add column if not exists stop_state_entered_at timestamptz;

comment on column vehicle_states.is_low_confidence is
  'True when confidence fell below the state estimator''s low-confidence threshold for this update. The row is still written (never silently dropped) so downstream consumers can see and filter it explicitly, per the "flagged, not silently trusted" requirement -- they must not treat a low-confidence row the same as a trusted one just because confidence is non-null.';
comment on column vehicle_states.kf_state is
  'Serialized Kalman filter state ({s, v, p, updatedAt}) for distance-along-route smoothing. Persisted so a control-service restart can rehydrate and resume smoothing without a full new observation cycle, rather than starting from a cold prior.';
comment on column vehicle_states.kf_updated_at is
  'Timestamp kf_state was last updated at (mirrors kf_state.updatedAt as a queryable column).';
comment on column vehicle_states.stop_state_entered_at is
  'Timestamp the vehicle entered current_stop_id''s geofence / the current stop_state began. Dwell duration is now() - stop_state_entered_at at read time.';

-- Leader-follower ordering queries filter/sort by (route_direction_id,
-- distance_along_route_meters); this index matches that access pattern.
create index if not exists vehicle_states_route_direction_distance_idx
  on vehicle_states (route_direction_id, distance_along_route_meters);

commit;
