// Typed endpoint functions for pages + onboarding templates (MODULE-GUIDE.md "Web features").
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import {
  onboardingTemplateListSchema,
  onboardingTemplateSchema,
  pageSchema,
  pageSummaryListSchema,
  pageVersionListSchema,
  pageVersionSchema,
  type CreateOnboardingTemplateInput,
  type CreatePageInput,
  type OnboardingTemplate,
  type Page,
  type PageSummary,
  type PageVersion,
  type PageVersionSummary,
  type PatchOnboardingTemplateInput,
  type PatchPageInput,
} from './types.js'

const BASE = '/api/v1/pages'

export const fetchPages = (kind?: string): Promise<PageSummary[]> =>
  apiClient.get(`${BASE}${kind ? `?kind=${kind}` : ''}`, pageSummaryListSchema)

export const fetchPage = (id: string): Promise<Page> => apiClient.get(`${BASE}/${id}`, pageSchema)

export const createPage = (input: CreatePageInput, csrf: string): Promise<Page> =>
  apiClient.post(BASE, input, pageSchema, csrf)

export const patchPage = (id: string, input: PatchPageInput, csrf: string): Promise<Page> =>
  apiClient.patch(`${BASE}/${id}`, input, pageSchema, csrf)

export const deletePage = (id: string, csrf: string): Promise<void> =>
  apiClient.delete(`${BASE}/${id}`, csrf)

/** v1.1 SPEC 12: the undo behind the delete toast. A page delete is a soft delete, so this simply
 * clears `deleted_at` -- the server bounds it to a 10-minute window (see `pages/repo.ts`). */
export const restorePage = (id: string, csrf: string): Promise<void> =>
  apiClient.post(`${BASE}/${id}/restore`, {}, z.void(), csrf)

export const fetchVersions = (pageId: string): Promise<PageVersionSummary[]> =>
  apiClient.get(`${BASE}/${pageId}/versions`, pageVersionListSchema)

export const fetchVersion = (pageId: string, versionId: string): Promise<PageVersion> =>
  apiClient.get(`${BASE}/${pageId}/versions/${versionId}`, pageVersionSchema)

export const restoreVersion = (pageId: string, versionId: string, csrf: string): Promise<Page> =>
  apiClient.post(`${BASE}/${pageId}/versions/restore`, { versionId }, pageSchema, csrf)

export const fetchOnboardingTemplates = (): Promise<OnboardingTemplate[]> =>
  apiClient.get(`${BASE}/onboarding/templates`, onboardingTemplateListSchema)

export const createOnboardingTemplate = (
  input: CreateOnboardingTemplateInput,
  csrf: string,
): Promise<OnboardingTemplate> =>
  apiClient.post(`${BASE}/onboarding/templates`, input, onboardingTemplateSchema, csrf)

export const patchOnboardingTemplate = (
  id: string,
  input: PatchOnboardingTemplateInput,
  csrf: string,
): Promise<OnboardingTemplate> =>
  apiClient.patch(`${BASE}/onboarding/templates/${id}`, input, onboardingTemplateSchema, csrf)

export const deleteOnboardingTemplate = (id: string, csrf: string): Promise<void> =>
  apiClient.delete(`${BASE}/onboarding/templates/${id}`, csrf)
