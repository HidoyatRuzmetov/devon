// Public API of @devon/db. This is the ONLY module other packages may import from -- `EPIC-000.6`
// (apps/api) and `EPIC-000.demo` (the seed) import only from here, never from `./context.js` or any
// other `src/*` path directly (handoff contract, agentic/ledger/cycles/EPIC-000/items/EPIC-000.2.md).
export {
  withContext,
  configurePool,
  closePool,
  TenancyContextMissing,
  type RequestContext,
  type Tx,
  type Role,
} from './context.js'

export type { AuditEventInput, PrivateReadInput, ChainVerification } from './audit.js'
export { verifyChain } from './audit.js'

export {
  TENANCY,
  GLOBAL_ALLOWLIST,
  checkTenancyCoverage,
  type TableClass,
  type TenancyCoverageResult,
} from './tenancy.js'

export {
  USER_FIELD_TIER,
  USER_FIELD_TIER_SQL,
  SECRET_USER_FIELDS,
  SECRET_USER_FIELDS_SQL,
  fieldsOfTier,
  type FieldTier,
} from './tiers.js'

export { normalizeUz } from './normalize-uz.js'

export {
  CURRENT_DEPARTMENT_ID_FN,
  CURRENT_USER_ID_FN,
  CURRENT_ACTOR_ROLE_FN,
  IS_VIEW_AS_FN,
  departmentTableDDL,
  userTableDDL,
  departmentTable,
  userTable,
  dropTableDDL,
} from './rls.js'

export * as schema from './schema/index.js'
