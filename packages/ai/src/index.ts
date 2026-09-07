// Public API of @devon/ai (mirrors the @devon/db / @devon/ui convention: consumers import only from
// here). `apps/api/src/modules/ai` is the one consumer today.
export {
  loadAiConfig,
  hasApiKey,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_PRICE_PER_MILLION_UZS,
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
export type { FeatureSpec } from './feature-spec.js'

export type {
  AiFeature,
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
export { AI_FEATURES } from './types.js'

export { localeSchema, cardPrioritySchema, idTitleSchema } from './schemas.js'

// Feature-specific input/output types + Zod schemas, re-exported so `apps/api/src/modules/ai`'s own
// route schemas can build directly on these instead of redeclaring them.
export {
  quickAddInputSchema,
  quickAddOutputSchema,
  type QuickAddInput,
  type QuickAddOutput,
} from './prompts/quick-add-parse.js'
export {
  subtaskBreakdownInputSchema,
  subtaskBreakdownOutputSchema,
  type SubtaskBreakdownInput,
  type SubtaskBreakdownOutput,
} from './prompts/subtask-breakdown.js'
export {
  planSprintInputSchema,
  planSprintOutputSchema,
  type PlanSprintInput,
  type PlanSprintOutput,
} from './prompts/plan-sprint.js'
export {
  deadlineRiskInputSchema,
  deadlineRiskOutputSchema,
  type DeadlineRiskInput,
  type DeadlineRiskOutput,
} from './prompts/deadline-risk.js'
export {
  weeklySummaryInputSchema,
  weeklySummaryOutputSchema,
  type WeeklySummaryInput,
  type WeeklySummaryOutput,
} from './prompts/weekly-summary.js'
export {
  draftEventInputSchema,
  draftEventOutputSchema,
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
  type NlAnalyticsInput,
  type NlAnalyticsOutput,
} from './prompts/nl-analytics.js'
export {
  translateInputSchema,
  translateOutputSchema,
  type TranslateInput,
  type TranslateOutput,
} from './prompts/translate.js'
export {
  whatDidIMissInputSchema,
  whatDidIMissOutputSchema,
  type WhatDidIMissInput,
  type WhatDidIMissOutput,
} from './prompts/what-did-i-miss.js'

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
