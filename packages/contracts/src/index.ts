// Public API of @devon/contracts. This is the only module other packages may import from (mirrors the
// @devon/db and @devon/i18n convention) -- `@devon/api` (EPIC-000.6) and `@devon/web` (EPIC-000.7)
// import only from here, never from `./permissions.js` or any other `src/*` path directly.
export {
  can,
  type Role,
  type Membership,
  type Actor,
  type Action,
  type Subject,
  type DenyReason,
  type Decision,
} from './permissions.js'

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
  INDICATORS,
  INDICATOR_KEYS,
  getIndicator,
  indicatorsVisibleTo,
  isIndicatorKey,
  type IndicatorFormat,
  type IndicatorKey,
  type IndicatorSource,
  type IndicatorSpec,
  type IndicatorType,
  type IndicatorValue,
  type PersonIndicators,
} from './indicators.js'

export {
  FIELD_CAPS,
  FIELD_EMPTY_WORDS,
  FIELD_KEY_RE,
  FIELD_LONG_TEXT_MAX,
  FIELD_REMINDER_DEFAULT_DAYS,
  FIELD_REMINDER_MAX_DAYS,
  FIELD_REMINDER_MIN_DAYS,
  FIELD_TEXT_MAX,
  FIELD_TYPES,
  blockedLabelLocale,
  isBlockedFieldLabel,
  isFieldEmptyWord,
  isFieldType,
  isFieldValueMissing,
  isOptionType,
  isValidFieldKey,
  normalizeFieldLabel,
  suggestFieldKey,
  validateFieldValue,
  type FieldValueCheck,
  type FieldValueError,
  type CustomFieldsPort,
  type FieldAppliesTo,
  type FieldDef,
  type FieldOption,
  type FieldRequest,
  type FieldRequestProgress,
  type FieldType,
  type FieldValue,
  type FieldValueRecord,
  type FieldVisibility,
} from './custom-fields.js'

export {
  MINIAPP_INIT_DATA_HEADER,
  MINIAPP_ROUTES,
  MINIAPP_ROUTE_KEYS,
  isMiniappRouteKey,
  type MiniappBoardPeek,
  type MiniappCard,
  type MiniappField,
  type MiniappFields,
  type MiniappFieldValue,
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
  problem,
  PROBLEM_CODES,
  problemSchema,
  type ProblemCode,
  type Problem,
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
  isSafeUrl,
  richTextDocSchema,
  richTextNodeSchema,
  RICH_TEXT_MARK_TYPES,
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_NODE_TYPES,
  SAFE_URL_SCHEMES,
  type RichTextNode,
} from './rich-text.js'

export {
  parseFilterQuery,
  serializeFilterQuery,
  resolveDateWord,
  matchesFilterQuery,
  cardMatchesFilterText,
  type CardFilterStatus,
  type CompareOp,
  type FilterClause,
  type FilterQuery,
  type FilterableCard,
  type FilterContext,
} from './filter-grammar.js'

export {
  DEFAULT_PEOPLE_COLUMNS,
  DEFAULT_PEOPLE_VIEW_CONFIG,
  PEOPLE_VIEW_CAPS,
  PEOPLE_VIEW_URL_PARAM,
  decodePeopleViewConfig,
  encodePeopleViewConfig,
  normalizePeopleViewConfig,
  peopleColumnFilterSchema,
  peopleFilterOpSchema,
  peopleViewConfigSchema,
  peopleViewDensitySchema,
  peopleViewGroupBySchema,
  peopleViewSchema,
  peopleViewSortSchema,
  samePeopleViewConfig,
  type PeopleColumnFilter,
  type PeopleFilterOp,
  type PeopleView,
  type PeopleViewConfig,
  type PeopleViewDensity,
  type PeopleViewGroupBy,
  type PeopleViewSort,
} from './people-views.js'
