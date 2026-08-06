-- Control service — core data model
--
-- Route/stop/control-point, trip/block, vehicle/headway state, bunching
-- incident, recommendation, command, and outcome tables, plus per-route-
-- direction policy configuration. See ../../README.md for how this file
-- fits into the control service's own datastore, and
-- docs/CONTROL_SERVICE_INTEGRATION.md (repo root) for the contract that
-- keeps this schema out of reach of the Next.js app.
--
-- Idempotent: every statement is safe to re-run. This is the first
-- migration for this datastore — do not edit it once applied anywhere;
-- add a new file for any follow-up change.
--
-- Tables created by this file (for the rollback note in ../../README.md):
--   corridors, routes, route_directions, route_shapes, route_links,
--   stops, route_direction_stops, vehicles, blocks, trips,
--   trip_stop_times, vehicle_states, headway_states, bunching_incidents,
--   bunching_incident_members, dispatcher_actions, recommendations,
--   commands, outcomes, route_policies.

begin;

-- ============================================================================
-- Extensions
-- ============================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ============================================================================
-- Shared helper: updated_at trigger
-- ============================================================================

create or replace function control_service_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function control_service_set_updated_at() is
  'Stamps updated_at := now() on every UPDATE. Attached per-table below.';

-- ============================================================================
-- Route, route shape, stop / control point
-- ============================================================================

create table if not exists corridors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

comment on table corridors is
  'A shared trunk segment spanning multiple routes/directions (blueprint 6.5, 12.1 "corridor memberships"). Corridor-level ordering lets the control service target shared segments rather than relying only on per-route order.';

create table if not exists routes (
  id             text primary key, -- natural upstream route_id, matches src/models/canonical.ts CanonicalLiveBus.routeId
  public_name    text not null,
  operating_mode text not null default 'timetable_managed'
                 check (operating_mode in ('headway_managed', 'timetable_managed', 'hybrid')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table routes is 'Route master data (blueprint 12.1 "Route"). Direction definitions live in route_directions.';

drop trigger if exists set_updated_at on routes;
create trigger set_updated_at before update on routes
  for each row execute function control_service_set_updated_at();

create table if not exists route_directions (
  id             uuid primary key default gen_random_uuid(),
  route_id       text not null references routes (id) on delete restrict,
  direction_code text not null, -- e.g. 'UP' / 'DOWN', or a numeric code from the ops system
  direction_name text,
  corridor_id    uuid references corridors (id) on delete set null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (route_id, direction_code)
);

comment on table route_directions is
  'One directional operating pattern of a route (blueprint 12.1, 5.1 "partition real-time processing by route x direction"). Every trip, vehicle state, headway state, incident, and policy row keys off this, not off routes.id, so leader/follower order is never computed across two directions.';

create index if not exists route_directions_route_id_idx on route_directions (route_id);
create index if not exists route_directions_corridor_id_idx on route_directions (corridor_id);

drop trigger if exists set_updated_at on route_directions;
create trigger set_updated_at before update on route_directions
  for each row execute function control_service_set_updated_at();

-- Full route-direction shape, one row per route-direction, for map-matching
-- and nearest-point projection (blueprint 6.1 "project each GPS coordinate
-- onto the active route shape"). geography(LineString) so ST_Distance /
-- the KNN <-> operator return metres directly, no manual SRID handling.
create table if not exists route_shapes (
  id                    uuid primary key default gen_random_uuid(),
  route_direction_id    uuid not null unique references route_directions (id) on delete cascade,
  geom                  geography(LineString, 4326) not null,
  total_distance_meters numeric not null check (total_distance_meters > 0),
  surveyed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table route_shapes is
  'Full route-direction polyline used for map matching / distance-along-route (s) computation (blueprint 6.1). Query nearest point on the route to a live GPS fix with ST_LineLocatePoint / ST_ClosestPoint against geom, or rank routes by proximity with the <-> KNN operator.';

create index if not exists route_shapes_geom_gix on route_shapes using gist (geom);

drop trigger if exists set_updated_at on route_shapes;
create trigger set_updated_at before update on route_shapes
  for each row execute function control_service_set_updated_at();

-- Route shape broken into ordered links/segments carrying cumulative
-- distance, speed bounds and control restrictions (blueprint 12.1 "Route
-- shape/link": "ordered geometry, cumulative distance, speed bounds,
-- no-overtake/control restrictions").
create table if not exists route_links (
  id                     uuid primary key default gen_random_uuid(),
  route_direction_id     uuid not null references route_directions (id) on delete cascade,
  sequence               integer not null check (sequence >= 0),
  geom                   geography(LineString, 4326) not null,
  cumulative_distance_start_meters numeric not null check (cumulative_distance_start_meters >= 0),
  cumulative_distance_end_meters   numeric not null,
  speed_limit_kmph       numeric check (speed_limit_kmph > 0),
  no_overtake            boolean not null default false,
  control_restricted     boolean not null default false,
  created_at             timestamptz not null default now(),
  unique (route_direction_id, sequence),
  check (cumulative_distance_end_meters > cumulative_distance_start_meters)
);

comment on table route_links is
  'Ordered sub-segments of a route-direction shape. no_overtake / control_restricted are the physical constraints referenced by the MPC objective (blueprint 8.6) and the safety filter (blueprint 9.2).';

create index if not exists route_links_route_direction_id_idx on route_links (route_direction_id, sequence);
create index if not exists route_links_geom_gix on route_links using gist (geom);

-- Physical stop location. One row per physical stop; route-direction-
-- specific sequencing and control-point configuration lives in
-- route_direction_stops below, since the same stop can appear on multiple
-- routes/directions at a different sequence position.
create table if not exists stops (
  id            text primary key, -- natural upstream stop_id, matches src/models/canonical.ts CanonicalStop.id
  name          text not null,
  geom          geography(Point, 4326) not null,
  layby_berth   boolean not null default false,
  shelter_flag  boolean not null default false,
  weather_flag  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table stops is
  'Physical stop master data (blueprint 12.1 "Stop/control point"). geography(Point) so ST_DWithin(geom, point, radius_m) and the <-> KNN operator both return correct results without a manual SRID transform.';

create index if not exists stops_geom_gix on stops using gist (geom);

drop trigger if exists set_updated_at on stops;
create trigger set_updated_at before update on stops
  for each row execute function control_service_set_updated_at();

-- Config-not-code: whether/how a stop functions as a control point on a
-- given route-direction, and its geofence, are configuration values, not
-- constants baked into detection/control code (blueprint Appendix C
-- "Control points: Stop IDs, geofences, hold suitability, max hold,
-- shelter/weather rule").
create table if not exists route_direction_stops (
  id                    uuid primary key default gen_random_uuid(),
  route_direction_id    uuid not null references route_directions (id) on delete cascade,
  stop_id               text not null references stops (id) on delete restrict,
  sequence              integer not null check (sequence >= 0),
  cumulative_distance_meters numeric not null check (cumulative_distance_meters >= 0),
  is_control_point      boolean not null default false,
  hold_suitable         boolean not null default false,
  max_hold_seconds      integer check (max_hold_seconds is null or max_hold_seconds >= 0),
  geofence_radius_meters numeric not null default 30 check (geofence_radius_meters > 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (route_direction_id, sequence),
  unique (route_direction_id, stop_id),
  -- exposes (id, route_direction_id) as a composite unique key so
  -- trip_stop_times can enforce "this stop-time's route_direction_stop
  -- actually belongs to the trip's route_direction" via a plain FK below,
  -- instead of a trigger.
  unique (id, route_direction_id)
);

comment on table route_direction_stops is
  'Per-route-direction stop sequencing plus control-point configuration (config, not code). The stop geofence is queried as ST_DWithin(stops.geom, vehicle_point, route_direction_stops.geofence_radius_meters) rather than a stored polygon, so changing a geofence radius is a config UPDATE, never a code change. max_hold_seconds overrides route_policies.max_hold_seconds for this specific control point when set.';

create index if not exists route_direction_stops_route_direction_id_idx on route_direction_stops (route_direction_id, sequence);
create index if not exists route_direction_stops_stop_id_idx on route_direction_stops (stop_id);
create index if not exists route_direction_stops_control_points_idx
  on route_direction_stops (route_direction_id) where is_control_point;

drop trigger if exists set_updated_at on route_direction_stops;
create trigger set_updated_at before update on route_direction_stops
  for each row execute function control_service_set_updated_at();

-- ============================================================================
-- Vehicle, block, trip
-- ============================================================================

create table if not exists vehicles (
  id                  text primary key, -- natural upstream vehicle_id
  registration_number text not null unique,
  vehicle_type        text,
  depot_name          text,
  capacity            integer check (capacity is null or capacity > 0),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table vehicles is 'Vehicle master data, keyed the same way as src/models/canonical.ts CanonicalLiveBus.id/registrationNumber.';

drop trigger if exists set_updated_at on vehicles;
create trigger set_updated_at before update on vehicles
  for each row execute function control_service_set_updated_at();

create table if not exists blocks (
  id           text primary key, -- natural upstream block_id/code
  service_date date not null,
  block_code   text not null,
  vehicle_id   text references vehicles (id) on delete set null,
  crew_ref     text, -- opaque crew/duty reference; crew scheduling is out of this ticket's scope
  created_at   timestamptz not null default now(),
  unique (service_date, block_code)
);

comment on table blocks is
  'Vehicle/crew block for a service day (blueprint 12.1 "Trip/block": "vehicle/crew block"). A trip references the block it runs within so relief and terminal constraints can be checked across the whole block, not just one trip.';

create index if not exists blocks_vehicle_id_idx on blocks (vehicle_id);
create index if not exists blocks_service_date_idx on blocks (service_date);

create table if not exists trips (
  id                          text primary key, -- natural upstream trip_id, matches CanonicalSchedule.tripId
  route_direction_id          uuid not null references route_directions (id) on delete restrict,
  block_id                    text references blocks (id) on delete set null,
  vehicle_id                  text references vehicles (id) on delete set null,
  service_date                date not null,
  scheduled_start_time        timestamptz not null,
  scheduled_end_time          timestamptz not null,
  origin_stop_id              text not null references stops (id) on delete restrict,
  destination_stop_id         text not null references stops (id) on delete restrict,
  relief_point_stop_id        text references stops (id) on delete set null,
  status                      text not null default 'scheduled'
                              check (status in ('scheduled', 'active', 'completed', 'cancelled', 'short_turned', 'deadhead')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (scheduled_end_time > scheduled_start_time),
  -- exposes (id, route_direction_id) as a composite unique key, mirrored
  -- on route_direction_stops, so trip_stop_times can FK against both and
  -- Postgres itself rejects a stop-time whose stop isn't on this trip's
  -- route_direction (see trip_stop_times below).
  unique (id, route_direction_id)
);

comment on table trips is
  'Trip/block (blueprint 12.1): "trip_id, service day, stop times, vehicle/crew block, terminal and relief constraints." Short-turns, deadheads, and diversions are explicit status values (blueprint 6.2) rather than being forced onto a normal scheduled trip.';

create index if not exists trips_route_direction_id_idx on trips (route_direction_id);
create index if not exists trips_block_id_idx on trips (block_id);
create index if not exists trips_vehicle_id_idx on trips (vehicle_id);
create index if not exists trips_service_date_idx on trips (service_date);
create index if not exists trips_status_idx on trips (status) where status in ('scheduled', 'active');

drop trigger if exists set_updated_at on trips;
create trigger set_updated_at before update on trips
  for each row execute function control_service_set_updated_at();

create table if not exists trip_stop_times (
  id                       uuid primary key default gen_random_uuid(),
  trip_id                  text not null,
  route_direction_id       uuid not null,
  route_direction_stop_id  uuid not null,
  sequence                 integer not null check (sequence >= 0),
  scheduled_arrival        timestamptz,
  scheduled_departure      timestamptz,
  created_at               timestamptz not null default now(),
  unique (trip_id, route_direction_stop_id),
  unique (trip_id, sequence),
  -- composite FKs enforce route-direction/trip/stop integrity in the
  -- database itself: a stop-time's route_direction_id must equal both
  -- its trip's and its route_direction_stop's route_direction_id, so a
  -- stop from a different route/direction than the trip can never be
  -- inserted.
  foreign key (trip_id, route_direction_id)
    references trips (id, route_direction_id) on delete cascade,
  foreign key (route_direction_stop_id, route_direction_id)
    references route_direction_stops (id, route_direction_id) on delete restrict
);

comment on table trip_stop_times is
  'Scheduled stop times for one trip. The paired (trip_id, route_direction_id) and (route_direction_stop_id, route_direction_id) foreign keys make it a database-level error, not just an application bug, to attach a stop from a different route/direction than the trip runs on.';

create index if not exists trip_stop_times_trip_id_idx on trip_stop_times (trip_id, sequence);
create index if not exists trip_stop_times_rds_id_idx on trip_stop_times (route_direction_stop_id);

-- ============================================================================
-- Vehicle state, headway state
-- ============================================================================

-- Current live state of each vehicle (blueprint 12.1 "Vehicle state":
-- "vehicle_id, trip, route-direction, s, speed, stop state, occupancy,
-- confidence, last update"). One row per vehicle, upserted by the state
-- estimator on every processed GPS fix — this is deliberately a current-
-- state table, not a time series; a time-series/history store for
-- telemetry is a Phase 4 concern (docs/PRODUCTION_ROADMAP.md) and out of
-- scope here.
create table if not exists vehicle_states (
  vehicle_id                text primary key references vehicles (id) on delete cascade,
  trip_id                   text references trips (id) on delete set null,
  route_direction_id        uuid references route_directions (id) on delete set null,
  position                  geography(Point, 4326),
  distance_along_route_meters numeric,
  speed_kmph                numeric,
  heading_degrees           numeric check (heading_degrees is null or (heading_degrees >= 0 and heading_degrees < 360)),
  stop_state                text not null default 'off_route'
                            check (stop_state in ('approaching_stop', 'dwelling_at_stop', 'held_by_controller', 'stopped_in_traffic', 'departed_stop', 'off_route')),
  current_stop_id            text references stops (id) on delete set null,
  occupancy_count            integer check (occupancy_count is null or occupancy_count >= 0),
  occupancy_load_band        text,
  confidence                 numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  observed_at                timestamptz not null,
  updated_at                 timestamptz not null default now()
);

comment on table vehicle_states is
  'Latest live state per vehicle. stop_state values are the blueprint 6.4 stop-state classification. confidence must decay with time since observed_at at the application layer (blueprint 6.3) — the schema only stores the last computed value.';

create index if not exists vehicle_states_route_direction_id_idx on vehicle_states (route_direction_id);
create index if not exists vehicle_states_trip_id_idx on vehicle_states (trip_id);
create index if not exists vehicle_states_position_gix on vehicle_states using gist (position);
create index if not exists vehicle_states_current_stop_id_idx on vehicle_states (current_stop_id);

drop trigger if exists set_updated_at on vehicle_states;
create trigger set_updated_at before update on vehicle_states
  for each row execute function control_service_set_updated_at();

-- Headway state between a leader/follower pair (blueprint 12.1 "Headway
-- state": "leader, follower, h_fwd, h_bwd, H*, deviation, forecast
-- values, confidence"; 7.1 forward/backward headway definitions).
create table if not exists headway_states (
  id                        uuid primary key default gen_random_uuid(),
  route_direction_id        uuid not null references route_directions (id) on delete cascade,
  leader_vehicle_id         text not null references vehicles (id) on delete cascade,
  follower_vehicle_id       text not null references vehicles (id) on delete cascade,
  h_fwd_seconds             numeric,
  h_bwd_seconds             numeric,
  target_headway_seconds    numeric not null check (target_headway_seconds > 0), -- H*
  deviation_seconds         numeric,
  forecast_h_fwd_seconds    numeric,
  confidence                numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  computed_at                timestamptz not null default now(),
  check (leader_vehicle_id <> follower_vehicle_id)
);

comment on table headway_states is
  'Point-in-time headway computation between one leader/follower pair on a route-direction. Append-only (no update trigger) so the detection tiers (blueprint 7.3) can look back over recent samples for the "k consecutive samples" reactive rule.';

create index if not exists headway_states_route_direction_computed_idx on headway_states (route_direction_id, computed_at desc);
create index if not exists headway_states_leader_idx on headway_states (leader_vehicle_id, computed_at desc);
create index if not exists headway_states_follower_idx on headway_states (follower_vehicle_id, computed_at desc);

-- ============================================================================
-- Bunching incident
-- ============================================================================

create table if not exists bunching_incidents (
  id                  uuid primary key default gen_random_uuid(),
  route_direction_id  uuid not null references route_directions (id) on delete restrict,
  severity            text not null check (severity in ('warning', 'bunched', 'severe')),
  cause_class         text not null default 'unknown'
                      check (cause_class in ('endogenous', 'exogenous', 'structural', 'unknown')),
  controllability     text not null default 'controllable'
                      check (controllability in ('controllable', 'mitigable', 'structural', 'none')),
  status              text not null default 'open'
                      check (status in ('open', 'mitigating', 'recovering', 'closed', 'escalated')),
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  evidence            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

comment on table bunching_incidents is
  'Bunching incident (blueprint 12.1: "incident_id, members, start/end, severity, cause, controllability, evidence, status"; 7.4 scenario classification). Member vehicles/platoon roles live in bunching_incident_members.';

create index if not exists bunching_incidents_route_direction_status_idx on bunching_incidents (route_direction_id, status);
create index if not exists bunching_incidents_open_idx on bunching_incidents (route_direction_id) where status <> 'closed';

drop trigger if exists set_updated_at on bunching_incidents;
create trigger set_updated_at before update on bunching_incidents
  for each row execute function control_service_set_updated_at();

create table if not exists bunching_incident_members (
  incident_id  uuid not null references bunching_incidents (id) on delete cascade,
  vehicle_id   text not null references vehicles (id) on delete cascade,
  member_role  text not null default 'platoon_member'
              check (member_role in ('leader', 'follower', 'platoon_member')),
  added_at     timestamptz not null default now(),
  primary key (incident_id, vehicle_id)
);

comment on table bunching_incident_members is 'Vehicles participating in a bunching incident, and their role in it (blueprint 7.3 platoon clustering).';

create index if not exists bunching_incident_members_vehicle_idx on bunching_incident_members (vehicle_id);

-- ============================================================================
-- Dispatcher authorization (integration-contract prerequisite for commands)
-- ============================================================================

-- A logged, human-initiated approval record. Per
-- docs/CONTROL_SERVICE_INTEGRATION.md section 1 ("Dispatcher-authorization
-- enforcement (non-negotiable)"): any command that could affect an
-- operational action must reference a valid, unconsumed dispatcher_action
-- created by the web app before the control service is asked to act. This
-- table is what "valid, unconsumed" is checked against; commands.dispatcher_action_id
-- is NOT NULL and UNIQUE (see below) so each approval authorizes exactly
-- one command and can never be replayed for a second one.
create table if not exists dispatcher_actions (
  id                  uuid primary key default gen_random_uuid(),
  dispatcher_id       text not null, -- human identity; SSO/RBAC identity provider is a Phase 4 concern
  action_type         text not null,
  route_direction_id  uuid references route_directions (id) on delete set null,
  vehicle_id          text references vehicles (id) on delete set null,
  incident_id         uuid references bunching_incidents (id) on delete set null,
  reason              text,
  authorized_at       timestamptz not null default now(),
  consumed_at         timestamptz,
  created_at          timestamptz not null default now()
);

comment on table dispatcher_actions is
  'One logged human approval decision. Every operational command must trace back to exactly one row here (blueprint 5.1 "preserve a complete audit trail ... approver"). consumed_at is stamped by consume_dispatcher_action() when a command is created against it.';

create index if not exists dispatcher_actions_dispatcher_id_idx on dispatcher_actions (dispatcher_id);
create index if not exists dispatcher_actions_unconsumed_idx on dispatcher_actions (id) where consumed_at is null;

-- ============================================================================
-- Recommendation, command, outcome
-- ============================================================================

create table if not exists recommendations (
  id                       uuid primary key default gen_random_uuid(),
  incident_id              uuid references bunching_incidents (id) on delete set null,
  route_direction_id       uuid not null references route_directions (id) on delete restrict,
  candidate_actions        jsonb not null default '[]'::jsonb,
  selected_action_type     text,
  objective_cost           numeric,
  expected_recovery_seconds numeric,
  constraints               jsonb not null default '{}'::jsonb,
  model_version             text,
  controller_version        text,
  status                    text not null default 'proposed'
                            check (status in ('proposed', 'selected', 'superseded', 'rejected')),
  created_at                timestamptz not null default now()
);

comment on table recommendations is
  'A controller-generated recommendation (blueprint 12.1: "candidate actions, objective cost, expected recovery, constraints, model/controller versions"; 8.8 action selection policy). Append-only; a new row is written whenever the controller re-plans (blueprint 9.1 step 11).';

create index if not exists recommendations_incident_id_idx on recommendations (incident_id);
create index if not exists recommendations_route_direction_created_idx on recommendations (route_direction_id, created_at desc);

create table if not exists commands (
  id                    uuid primary key default gen_random_uuid(),
  recommendation_id     uuid references recommendations (id) on delete set null,
  vehicle_id            text not null references vehicles (id) on delete restrict,
  trip_id               text references trips (id) on delete set null,
  action_type           text not null
                        check (action_type in (
                          'terminal_dispatch_hold', 'two_way_hold', 'self_equalizing_hold',
                          'speed_guidance', 'stop_skip', 'short_turn', 'deadhead',
                          'boarding_limit', 'standby_injection'
                        )),
  target_stop_id        text references stops (id) on delete set null,
  parameters             jsonb not null default '{}'::jsonb,
  -- Dispatcher-authorization enforcement (integration-contract section 1,
  -- non-negotiable): every command must reference exactly one unconsumed
  -- dispatcher_action. NOT NULL + UNIQUE means the database itself refuses
  -- a command with no valid approval, and refuses a second command from
  -- reusing the same approval.
  dispatcher_action_id   uuid not null unique references dispatcher_actions (id) on delete restrict,
  ttl_seconds             integer not null check (ttl_seconds > 0),
  valid_from              timestamptz not null default now(),
  expires_at              timestamptz not null,
  policy_version          text,
  status                  text not null default 'proposed'
                          check (status in (
                            'proposed', 'awaiting_approval', 'authorized', 'delivered',
                            'acknowledged', 'executing', 'completed', 'expired', 'cancelled', 'failed'
                          )),
  delivered_at             timestamptz,
  acknowledged_at          timestamptz,
  acknowledgement_reason   text, -- e.g. driver "unable/unsafe" reason (blueprint 9.2)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (expires_at > valid_from)
);

comment on table commands is
  'A command sent toward a vehicle/driver (blueprint 12.1: "command_id, recipient, action, parameters, TTL, authorization, status, acknowledgement"; 9.3 command lifecycle). action_type enumerates the control hierarchy levers (blueprint 8.1). Never issue one without a dispatcher_action_id — see docs/CONTROL_SERVICE_INTEGRATION.md section 1.';

create index if not exists commands_vehicle_id_status_idx on commands (vehicle_id, status);
create index if not exists commands_trip_id_idx on commands (trip_id);
create index if not exists commands_recommendation_id_idx on commands (recommendation_id);
create index if not exists commands_active_idx on commands (vehicle_id) where status in ('proposed', 'awaiting_approval', 'authorized', 'delivered', 'acknowledged', 'executing');

drop trigger if exists set_updated_at on commands;
create trigger set_updated_at before update on commands
  for each row execute function control_service_set_updated_at();

-- Enforces "unconsumed": a dispatcher_action can authorize at most one
-- command (also guaranteed by the UNIQUE constraint above), and rejects
-- the insert outright if the action was already consumed or does not
-- exist, closing the gap the UNIQUE constraint alone leaves open (an
-- already-consumed-by-something-else-entirely action, e.g. a future
-- non-command use).
create or replace function control_service_consume_dispatcher_action()
returns trigger
language plpgsql
as $$
declare
  v_consumed_at timestamptz;
begin
  select consumed_at into v_consumed_at
    from dispatcher_actions
    where id = new.dispatcher_action_id
    for update;

  if not found then
    raise exception 'dispatcher_action % does not exist', new.dispatcher_action_id;
  end if;

  if v_consumed_at is not null then
    raise exception 'dispatcher_action % is already consumed', new.dispatcher_action_id;
  end if;

  update dispatcher_actions set consumed_at = now() where id = new.dispatcher_action_id;

  return new;
end;
$$;

comment on function control_service_consume_dispatcher_action() is
  'Marks a dispatcher_action consumed at the moment a command is created against it, and rejects reuse of an already-consumed approval (integration-contract non-negotiable dispatcher-authorization rule).';

drop trigger if exists consume_dispatcher_action on commands;
create trigger consume_dispatcher_action before insert on commands
  for each row execute function control_service_consume_dispatcher_action();

create table if not exists outcomes (
  id                   uuid primary key default gen_random_uuid(),
  command_id           uuid unique references commands (id) on delete cascade,
  incident_id          uuid references bunching_incidents (id) on delete set null,
  actual_action        text,
  compliance           text check (compliance is null or compliance in ('complied', 'partial', 'unable', 'unsafe', 'no_response')),
  recovery_seconds     numeric,
  passenger_cost       numeric,
  guardrail_events     jsonb not null default '[]'::jsonb,
  final_attribution    jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

comment on table outcomes is
  'Measured result of a command/incident (blueprint 12.1: "actual control, compliance, recovery, passenger cost, guardrail events, final attribution"; blueprint 9.1 step 10-11). Feeds the "measured outcomes feed the next cycle" learning loop (blueprint figure 2).';

create index if not exists outcomes_incident_id_idx on outcomes (incident_id);

-- ============================================================================
-- Route policy configuration (config, not code)
-- ============================================================================

-- Everything in Appendix C of the blueprint ("Initial Route Configuration
-- Template") that is a tunable parameter rather than an algorithm: target
-- headway, thresholds, controller gains, occupancy policy, command
-- policy, safety bounds, fallback mode and KPI thresholds. Detection and
-- control code reads the active row for a route-direction/period/day-type
-- rather than hard-coding any of these values, so tuning is a config
-- UPDATE (with a new effective_from row, preserving history) and never a
-- deploy. Per-control-point hold caps and geofences are configured
-- per-row on route_direction_stops instead, since they vary point to
-- point, not just period to period.
create table if not exists route_policies (
  id                        uuid primary key default gen_random_uuid(),
  route_direction_id        uuid not null references route_directions (id) on delete cascade,
  operating_period          text not null default 'all'
                            check (operating_period in ('peak', 'off_peak', 'night', 'all')),
  day_type                  text not null default 'all'
                            check (day_type in ('weekday', 'weekend', 'holiday', 'all')),

  -- target headway + detection thresholds
  target_headway_seconds    numeric not null check (target_headway_seconds > 0), -- H*
  bunched_threshold_ratio   numeric not null default 0.25 check (bunched_threshold_ratio > 0 and bunched_threshold_ratio < 1), -- blueprint 7.3: "0.25 x H*"
  warning_threshold_ratio   numeric not null default 0.5 check (warning_threshold_ratio > 0 and warning_threshold_ratio < 1),
  required_samples          integer not null default 3 check (required_samples > 0),
  prediction_horizon_control_points integer not null default 3 check (prediction_horizon_control_points > 0),

  -- controller gains (blueprint 8.3, 8.4)
  kf                        numeric,
  kb                        numeric,
  self_equalizing_k         numeric,
  cooldown_seconds          integer not null default 60 check (cooldown_seconds >= 0),
  minimum_action_seconds    integer not null default 0 check (minimum_action_seconds >= 0),

  -- hold caps (default; route_direction_stops.max_hold_seconds overrides per control point)
  max_hold_seconds          integer not null default 90 check (max_hold_seconds >= 0),

  -- occupancy policy
  occupancy_stale_seconds   integer,
  occupancy_capacity        integer check (occupancy_capacity is null or occupancy_capacity > 0),

  -- authorization / command policy
  authorized_actions        jsonb not null default '{}'::jsonb, -- action_type -> 'automatic' | 'approval' | 'prohibited'
  command_ttl_seconds        integer not null default 120 check (command_ttl_seconds > 0),
  ack_timeout_seconds        integer not null default 30 check (ack_timeout_seconds > 0),
  retry_count                integer not null default 0 check (retry_count >= 0),
  escalation_policy          jsonb not null default '{}'::jsonb,

  -- safety constraints
  speed_band_min_kmph        numeric,
  speed_band_max_kmph        numeric,
  no_overtake                boolean not null default false,

  fallback_mode               text not null default 'observation_only'
                              check (fallback_mode in ('live', 'schedule_assisted', 'observation_only')),
  kpi_thresholds               jsonb not null default '{}'::jsonb,

  effective_from                timestamptz not null default now(),
  effective_to                   timestamptz,
  created_by                     text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (speed_band_max_kmph is null or speed_band_min_kmph is null or speed_band_max_kmph >= speed_band_min_kmph)
);

comment on table route_policies is
  'Config-not-code route policy: thresholds, controller gains, occupancy/command/safety policy, fallback mode and KPI thresholds per route-direction/period/day-type (blueprint Appendix C). A route policy is versioned by inserting a new row and closing the previous one (effective_to), never by mutating history in place.';

create index if not exists route_policies_route_direction_id_idx on route_policies (route_direction_id);
-- Only one active (open-ended) policy per route-direction/period/day-type at a time.
create unique index if not exists route_policies_active_unique_idx
  on route_policies (route_direction_id, operating_period, day_type)
  where effective_to is null;

drop trigger if exists set_updated_at on route_policies;
create trigger set_updated_at before update on route_policies
  for each row execute function control_service_set_updated_at();

commit;
