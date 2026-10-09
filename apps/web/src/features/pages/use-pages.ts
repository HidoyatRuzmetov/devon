// React Query hooks over `api.ts` (MODULE-GUIDE.md "Web features"), same shape as `personal/
// use-personal.ts`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import * as api from './api.js'
import type {
  CreateOnboardingTemplateInput,
  CreatePageInput,
  PatchOnboardingTemplateInput,
  PatchPageInput,
} from './types.js'

const KEYS = {
  pages: ['pages', 'list'] as const,
  page: (id: string) => ['pages', 'detail', id] as const,
  versions: (pageId: string) => ['pages', 'versions', pageId] as const,
  templates: ['pages', 'onboardingTemplates'] as const,
}

function useCsrfToken(): string {
  const meQuery = useMeQuery()
  return meQuery.data?.csrfToken ?? ''
}

export function usePagesQuery() {
  return useQuery({ queryKey: KEYS.pages, queryFn: () => api.fetchPages() })
}

export function usePageQuery(id: string | null) {
  return useQuery({
    queryKey: KEYS.page(id ?? ''),
    queryFn: () => api.fetchPage(id!),
    enabled: id !== null,
  })
}

export function useCreatePageMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreatePageInput) => api.createPage(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.pages }),
  })
}

export function usePatchPageMutation(id: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationKey: ['pages', 'write', id],
    scope: { id: `pages-write-${id}` },
    mutationFn: (input: PatchPageInput) => api.patchPage(id, input, csrf),
    onSuccess: (page) => {
      qc.setQueryData(KEYS.page(id), page)
      qc.invalidateQueries({ queryKey: KEYS.pages })
      qc.invalidateQueries({ queryKey: KEYS.versions(id) })
    },
    onError: () => qc.invalidateQueries({ queryKey: KEYS.page(id) }),
  })
}

export function useDeletePageMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.deletePage(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.pages }),
  })
}

/** SPEC 12: paired with `useDeletePageMutation` behind one undo toast. */
export function useRestorePageMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) => api.restorePage(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.pages }),
  })
}

export function useVersionsQuery(pageId: string | null) {
  return useQuery({
    queryKey: KEYS.versions(pageId ?? ''),
    queryFn: () => api.fetchVersions(pageId!),
    enabled: pageId !== null,
  })
}

export function useRestoreVersionMutation(pageId: string) {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationKey: ['pages', 'write', pageId],
    scope: { id: `pages-write-${pageId}` },
    mutationFn: (versionId: string) => api.restoreVersion(pageId, versionId, csrf),
    onSuccess: (page) => {
      qc.setQueryData(KEYS.page(pageId), page)
      qc.invalidateQueries({ queryKey: KEYS.pages })
      qc.invalidateQueries({ queryKey: KEYS.versions(pageId) })
    },
  })
}

export function useOnboardingTemplatesQuery() {
  return useQuery({ queryKey: KEYS.templates, queryFn: api.fetchOnboardingTemplates })
}

export function useCreateOnboardingTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: CreateOnboardingTemplateInput) => api.createOnboardingTemplate(input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.templates }),
  })
}

export function usePatchOnboardingTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationKey: ['pages', 'templates-write'],
    mutationFn: ({ id, input }: { id: string; input: PatchOnboardingTemplateInput }) =>
      api.patchOnboardingTemplate(id, input, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.templates }),
  })
}

export function useDeleteOnboardingTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationKey: ['pages', 'templates-write'],
    mutationFn: (id: string) => api.deleteOnboardingTemplate(id, csrf),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.templates }),
  })
}
