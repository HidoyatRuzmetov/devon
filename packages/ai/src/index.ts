// Public API of @devon/ai (mirrors the @devon/db / @devon/ui convention: consumers import only from
// here). `apps/api/src/modules/ai` is the one consumer today.
export {
  loadAiConfig,
  hasApiKey,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_PRICE_PER_MILLION_UZS,
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_EMBEDDINGS_DIMENSIONS,
  MIN_MAX_TOKENS,
  type AiConfig,
} from './config.js'

export {
  tokensToCostUzs,
  checkBudget,
  canAffordCall,
  type BudgetStatus,
  type BudgetCheck,
} from './budget.js'

export { trimHistory, estimateTokens } from './trim.js'

export { GlmProvider, GlmProviderError, type GlmProviderOptions } from './glm-provider.js'
export { MockProvider, type MockProviderOptions } from './mock-provider.js'

export { run, type RunOptions } from './gateway.js'
export {
  runFeature,
  buildOfflineRespond,
  getFeatureSpec,
  FEATURE_REGISTRY,
  type RunFeatureOptions,
  type RunFeatureResult,
} from './features.js'
export type { FeatureSpec, ValidateOutcome } from './feature-spec.js'

export { normalizeUzLatn, normalizeUzLatnDeep, hasAsciiApostrophe } from './uz.js'
export {
  DEPARTMENT_GLOSSARY,
  languageConstraint,
  ANTI_FABRICATION_CONSTRAINT,
  CITATION_CONSTRAINT,
  CITATION_CONSTRAINT as AI_CITATION_CONSTRAINT,
  TONE_CONSTRAINT,
} from './locale-prompt.js'

// AI L2 (EPIC-016): the runtime probe that decides whether semantic search runs on pgvector or on
// Postgres full-text search. Never a build-time assumption -- see `embeddings.ts`'s header.
export {
  probeEmbeddings,
  embed,
  MAX_EMBED_BATCH,
  PROBE_TTL_MS,
  type EmbeddingsProbe,
  type EmbedResult,
} from './embeddings.js'

export type {
  AiFeature,
  LegacyAiFeature,
  AiProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatRole,
  ChatUsage,
  FinishReason,
  Locale,
  RunMeta,
  RunResult,
  ToolCall,
  ToolDef,
} from './types.js'
export { AI_FEATURES, LEGACY_AI_FEATURES, AI_TRACE_FEATURES } from './types.js'

export {
  localeSchema,
  cardPrioritySchema,
  riskLevelSchema,
  confidenceSchema,
  idTitleSchema,
  memberRefSchema,
  labelRefSchema,
  projectRefSchema,
  type MemberRef,
} from './schemas.js'

// Feature-specific input/output types + Zod schemas, re-exported so `apps/api/src/modules/ai`'s own
// route schemas and `apps/web`'s client-side re-validation can build directly on these instead of
// redeclaring them.
export {
  quickAddInputSchema,
  quickAddOutputSchema,
  type QuickAddInput,
  type QuickAddOutput,
} from './prompts/quick-add-parse.js'
export {
  subtaskBreakdownInputSchema,
  subtaskBreakdownOutputSchema,
  ESTIMATE_BUCKETS,
  type SubtaskBreakdownInput,
  type SubtaskBreakdownOutput,
} from './prompts/subtask-breakdown.js'
export {
  planSprintInputSchema,
  planSprintOutputSchema,
  planItemSchema,
  type PlanSprintInput,
  type PlanSprintOutput,
} from './prompts/plan-sprint.js'
export {
  deadlineRiskInputSchema,
  deadlineRiskOutputSchema,
  riskActionKindSchema,
  type DeadlineRiskInput,
  type DeadlineRiskOutput,
  type RiskActionKind,
} from './prompts/deadline-risk.js'
export {
  catchUpInputSchema,
  catchUpOutputSchema,
  type CatchUpInput,
  type CatchUpOutput,
} from './prompts/catch-up.js'
export {
  draftEventInputSchema,
  draftEventOutputSchema,
  eventCategorySchema,
  type DraftEventInput,
  type DraftEventOutput,
} from './prompts/draft-event.js'
export {
  summarizeThreadInputSchema,
  summarizeThreadOutputSchema,
  type SummarizeThreadInput,
  type SummarizeThreadOutput,
} from './prompts/summarize-thread.js'
export {
  nlAnalyticsInputSchema,
  nlAnalyticsOutputSchema,
  analyticsMetricSchema,
  ANALYTICS_METRICS,
  type NlAnalyticsInput,
  type NlAnalyticsOutput,
  type AnalyticsMetric,
} from './prompts/nl-analytics.js'
export {
  translateInputSchema,
  translateOutputSchema,
  isLocalTransliterationPair,
  glossaryFor,
  type TranslateInput,
  type TranslateOutput,
} from './prompts/translate.js'
export {
  draftReplyInputSchema,
  draftReplyOutputSchema,
  type DraftReplyInput,
  type DraftReplyOutput,
} from './prompts/draft-reply.js'
export {
  boardRiskDigestInputSchema,
  boardRiskDigestOutputSchema,
  type BoardRiskDigestInput,
  type BoardRiskDigestOutput,
} from './prompts/board-risk-digest.js'
export {
  suggestAssigneeInputSchema,
  suggestAssigneeOutputSchema,
  type SuggestAssigneeInput,
  type SuggestAssigneeOutput,
} from './prompts/suggest-assignee.js'
export {
  duplicateCheckInputSchema,
  duplicateCheckOutputSchema,
  type DuplicateCheckInput,
  type DuplicateCheckOutput,
} from './prompts/duplicate-check.js'
export {
  semanticAskInputSchema,
  semanticAskOutputSchema,
  askSourceKindSchema,
  type SemanticAskInput,
  type SemanticAskOutput,
  type AskSourceKind,
} from './prompts/semantic-ask.js'

import { type AiConfig, hasApiKey } from './config.js'
import { buildOfflineRespond } from './features.js'
import { GlmProvider } from './glm-provider.js'
import { MockProvider } from './mock-provider.js'
import type { AiProvider } from './types.js'

/**
 * The one factory `apps/api/src/modules/ai` calls: a real `GlmProvider` when `AI_API_KEY` is
 * configured, otherwise a `MockProvider` wired to every feature's own offline `simulate()`
 * (TECH-SPEC §8: "a mock provider ... for when no key is configured"). Never constructed more than
 * once per process -- the API module builds it once at boot, alongside its other singletons.
 */
export function createProvider(config: AiConfig): AiProvider {
  if (hasApiKey(config)) {
    return new GlmProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey!,
      requestTimeoutMs: config.requestTimeoutMs,
    })
  }
  return new MockProvider({ respond: buildOfflineRespond() })
}
