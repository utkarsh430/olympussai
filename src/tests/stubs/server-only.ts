// Test-only stub for the 'server-only' package.
//
// Next.js ships its own build-time alias for 'server-only'/'client-only'
// (no npm package required) so production/dev builds already resolve
// `import 'server-only'` without this file. Vitest runs through plain Vite,
// which has no such built-in alias, so unit tests for server-only modules
// (e.g. src/lib/ops/fleetData.ts) need something real to resolve to — this
// intentionally-empty module, aliased in vitest.config.ts. It enforces
// nothing at test time, same as it enforces nothing once bundled for the
// server in a real Next.js build.
export {};
