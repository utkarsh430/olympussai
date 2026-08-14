#!/usr/bin/env node
// Proves every query in src/arrival-prediction/repository.ts actually PARSES
// and PLANS against a real PostGIS schema.
//
// Why this exists as a separate check rather than a test: nothing else in this
// repo can catch a SQL typo. `tsc`, eslint and the unit suite all pass happily
// on a query with a misspelled column, because the query is a string. The unit
// tests fake the pool - deliberately, so they stay fast and DB-free - which
// means they assert the PREDICATES are present but can never assert the query
// is valid. This closes that exact gap.
//
// It uses PREPARE, so the server parses, resolves every identifier and builds a
// plan WITHOUT executing anything. Read-only by construction: nothing here can
// write, and it is safe to point at a live database.
//
//   CONTROL_SERVICE_DATABASE_URL=postgres://... node scripts/check-arrival-sql.mjs
//
// Skips with exit code 0 when no database URL is configured, so it can sit in a
// pipeline that does not always have one.
import pg from 'pg';

const url = process.env.CONTROL_SERVICE_DATABASE_URL;
if (!url) {
  console.log('check-arrival-sql: CONTROL_SERVICE_DATABASE_URL not set, skipping');
  process.exit(0);
}

// Kept in step with src/arrival-prediction/repository.ts by hand. A query that
// exists there and not here is simply unchecked - which is why each name below
// matches its exported function.
const QUERIES = {
  loadVehicleStateForPrediction: `
    select vehicle_id, route_direction_id, distance_along_route_meters, speed_kmph,
           stop_state, current_stop_id, stop_state_entered_at, confidence,
           is_low_confidence, observed_at, kf_state,
           ST_Y(position::geometry) as lat, ST_X(position::geometry) as lon
      from vehicle_states
     where vehicle_id = $1`,
  vehicleExists: `select exists(select 1 from vehicles where id = $1) as exists`,
  loadRouteGeometry: `
    select rd.id as route_direction_id, rd.is_loop, rs.total_distance_meters
      from route_directions rd
      join route_shapes rs on rs.route_direction_id = rd.id
     where rd.id = $1 and rd.is_active = true`,
  loadRouteDirectionStops: `
    select rds.stop_id, s.name as stop_name, rds.sequence,
           rds.cumulative_distance_meters, rds.is_control_point,
           ST_Y(s.geom::geometry) as lat, ST_X(s.geom::geometry) as lon
      from route_direction_stops rds
      join stops s on s.id = rds.stop_id
     where rds.route_direction_id = $1
     order by rds.sequence`,
  loadPeerSpeeds: `
    select vehicle_id, distance_along_route_meters, speed_kmph
      from vehicle_states
     where route_direction_id = $1
       and distance_along_route_meters is not null
       and speed_kmph is not null
       and is_low_confidence = false
       and confidence >= $3
       and observed_at <= now()
       and observed_at >= now() - make_interval(secs => $2::double precision)`,
  loadActiveHold: `
    select exists(
       select 1 from commands
        where vehicle_id = $1
          and action_type = any($2::text[])
          and status = any($3::text[])
          and now() < expires_at
     ) as held`,
};

const client = new pg.Client({ connectionString: url });
await client.connect();

let failures = 0;
for (const [name, sql] of Object.entries(QUERIES)) {
  try {
    await client.query(`prepare check_${name} as ${sql}`);
    await client.query(`deallocate check_${name}`);
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}: ${error.message}`);
  }
}

await client.end();

if (failures > 0) {
  console.error(`check-arrival-sql: ${failures} quer${failures === 1 ? 'y' : 'ies'} failed to plan`);
  process.exit(1);
}
console.log(`check-arrival-sql: all ${Object.keys(QUERIES).length} queries plan cleanly`);
