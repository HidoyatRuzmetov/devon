// Public API of @devon/contracts. This is the only module other packages may import from (mirrors the
// @devon/db and @devon/i18n convention) -- `@devon/api` (EPIC-000.6) and `@devon/web` (EPIC-000.7)
// import only from here, never from `./permissions.js` or any other `src/*` path directly.
export { isPlainHttpUrl } from './http-url.js'
export { normalizeInvitationKey } from './invitation-key.js'
export {
  can,
  type Action,
  type Actor,
  type Decision,
  type DenyReason,
  type Membership,
  type Role,
  type Subject,
} from './permissions.js'
export { WORK_TITLE_MAX } from './work-limits.js'

export {
  APP_ACTIONS,
  APP_ACTION_IDS,
  FEATURE_AREAS,
  actionsForArea,
  allowsAction,
  canAction,
  isAppActionId,
  type ActionContext,
  type ActionSettings,
  type ActionSubjectKind,
  type ActionWidener,
  type AppActionId,
  type AppActionSpec,
  type FeatureAreaId,
} from './app-actions.js'

export {
  FEATURES,
  FEATURE_KEYS,
  allFeaturesOn,
  isFeatureKey,
  resolveFeatures,
  type FeatureFlags,
  type FeatureKey,
  type FeatureSpec,
} from './features.js'

export {
  MINIAPP_INIT_DATA_HEADER,
  MINIAPP_ROUTES,
  MINIAPP_ROUTE_KEYS,
  isMiniappRouteKey,
  type MiniappBoardPeek,
  type MiniappCard,
  type MiniappFocusAlert,
  type MiniappIdentity,
  type MiniappPerson,
  type MiniappRouteKey,
  type MiniappSession,
  type MiniappSetupChecklist,
  type MiniappSetupStepId,
  type MiniappSource,
} from './miniapp.js'

export {
  PROBLEM_CODES,
  problem,
  problemSchema,
  type Problem,
  type ProblemCode,
  type ProblemOptions,
} from './problem.js'

export {
  FIELD_TIERS,
  fieldsUpToTier,
  isVisibleAtTier,
  secretFields,
  type FieldTier,
  type ReadableTier,
} from './field-tiers.js'

export {
  RICH_TEXT_MARK_TYPES,
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_NODE_TYPES,
  SAFE_URL_SCHEMES,
  isSafeUrl,
  richTextDocSchema,
  richTextNodeSchema,
  type RichTextNode,
} from './rich-text.js'

export {
  cardMatchesFilterText,
  matchesFilterQuery,
  parseFilterQuery,
  resolveDateWord,
  serializeFilterQuery,
  type CardFilterStatus,
  type CompareOp,
  type FilterClause,
  type FilterContext,
  type FilterQuery,
  type FilterableCard,
} from './filter-grammar.js'

// v1.1 SPEC §7 / EPIC-017 (work-plus): estimates, recurrence, dependencies, templates, goals and
// automation rules -- the work rules the client has to understand as well as the server.
export {
  personalDeleteReceiptSchema,
  personalRestoreBodySchema,
  personalTaskVersionChangeSchema,
  personalTaskVersionsQuerySchema,
  type PersonalDeleteReceipt,
  type PersonalRestoreBody,
  type PersonalTaskVersionChange,
} from './personal.js'
export {
  HOURS_PER_WORKING_DAY,
  MAX_ESTIMATE_MINUTES,
  MAX_TIME_LOG_MINUTES,
  cardTemplatePayloadSchema,
  minutesToHours,
  nextOccurrence,
  parseEstimateMinutes,
  projectTemplatePayloadSchema,
  recurrenceFreqSchema,
  recurrenceModeSchema,
  recurrenceRuleSchema,
  splitEstimateMinutes,
  workTemplateKindSchema,
  workTemplateScopeSchema,
  wouldCreateDependencyCycle,
  type CardTemplatePayload,
  type DependencyEdge,
  type ProjectTemplatePayload,
  type RecurrenceFreq,
  type RecurrenceMode,
  type RecurrenceRule,
  type WorkTemplateKind,
  type WorkTemplateScope,
} from './work-plus.js'

export * from './ai-chat.js'
export * from './checkins.js'
export {
  professionalProfileRecordSchema,
  professionalProfileSchema,
  professionalProfileWriteRecordSchema,
  professionalProfileWriteSchema,
  type ProfessionalProfile,
} from './professional-profile.js'

export * from './personal-calendar.js'

export { aiActionBindingSchema } from './ai-chat.js'
