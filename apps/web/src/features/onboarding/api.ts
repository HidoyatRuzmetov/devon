import { z } from 'zod'
import { onboardingSessionSchema, onboardingDocumentSchema } from '@devon/contracts'
import { apiClient } from '../../lib/api-client.js'

export type ProgressUpdate = {
  htmlDone?: true
  completeSetup?: true
  tourStep?: number
  tourCompleted?: true
  paused?: boolean
}
export function updateOnboarding(csrf: string, update: ProgressUpdate = {}) {
  return apiClient.post('/api/v1/onboarding/session', update, onboardingSessionSchema, csrf)
}
export function fetchDocuments() {
  return apiClient.get(
    '/api/v1/onboarding/documents',
    z.object({
      revision: z.number(),
      items: z.array(onboardingDocumentSchema),
    }),
  )
}
export function fetchDocument(id: string) {
  return apiClient.get(
    `/api/v1/onboarding/documents/${id}`,
    z.object({ title: z.string(), html: z.string() }),
  )
}
export function uploadDocument(
  input: { title: string; filename: string; html: string },
  csrf: string,
) {
  return apiClient.post('/api/v1/onboarding/documents', input, z.object({ id: z.uuid() }), csrf)
}
export function decideDocument(
  id: string,
  action: 'publish' | 'reject',
  revision: number,
  csrf: string,
) {
  return apiClient.post(
    `/api/v1/onboarding/documents/${id}/decision`,
    { action, revision },
    z.object({ ok: z.literal(true) }),
    csrf,
  )
}
