// Typed endpoint functions for the AI module (MODULE-GUIDE.md "Web features"), built on the shared
// `apiClient` exactly like every other feature's `api.ts`.
import { apiClient } from '../../lib/api-client.js'
import {
  aiSettingsSchema,
  runFeatureResponseSchema,
  usageListSchema,
  type AiFeatureId,
  type AiSettings,
  type PatchAiSettingsInput,
  type RunFeatureResponse,
  type Trace,
} from './types.js'

const BASE = '/api/v1/ai'

export function fetchAiSettings(): Promise<AiSettings> {
  return apiClient.get(`${BASE}/settings`, aiSettingsSchema)
}

export function patchAiSettings(
  input: PatchAiSettingsInput,
  csrfToken: string,
): Promise<AiSettings> {
  return apiClient.patch(`${BASE}/settings`, input, aiSettingsSchema, csrfToken)
}

export async function fetchAiUsage(limit = 50): Promise<Trace[]> {
  const result = await apiClient.get(`${BASE}/usage?limit=${limit}`, usageListSchema)
  return result.traces
}

export function runAiFeature(
  feature: AiFeatureId,
  input: Record<string, unknown>,
  csrfToken: string,
): Promise<RunFeatureResponse> {
  return apiClient.post(
    `${BASE}/features/${feature}/run`,
    { input },
    runFeatureResponseSchema,
    csrfToken,
  )
}
