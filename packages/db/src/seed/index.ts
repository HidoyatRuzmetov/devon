// Barrel for the seed framework. Not re-exported from `../index.ts` (the package's public API) --
// nothing outside `@devon/db` seeds the demo tenant directly; the only sanctioned entry points are the
// `seed:demo` / `seed:reset` / `seed:demo:matrix` / `counts` package scripts (item handoff). This
// barrel exists so the CLI wrappers and `test/seed.idempotence.test.ts` import from one place.
export { assertSeedAllowed, SeedNotAllowedError, type SeedEnv } from './guard.js'
export { DEMO_NAMESPACE, uuidv5, demoId } from './ids.js'
export {
  DEMO_DEPARTMENT,
  DEMO_USERS,
  DEMO_MEMBERSHIPS,
  DEMO_SUPER_ADMIN,
  DEMO_DELETE_ORDER,
  DEMO_PASSWORD,
  computeDemoChecksum,
  demoPasswordHash,
  type DemoRole,
  type DemoUserFixture,
  type DemoDepartmentFixture,
  type DemoMembershipFixture,
  type DemoSuperAdminFixture,
} from './fixtures.js'
export {
  SEED_NAME,
  runSeedDemo,
  runResetDemo,
  type SeedDemoOutcome,
  type ResetDemoOutcome,
} from './demo.js'
export { loadSeedModules, type SeedModule, type SeedModuleContext } from './module-loader.js'
