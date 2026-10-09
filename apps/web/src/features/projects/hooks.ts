// React Query hooks for the group-projects module -- same shape as `../work/hooks.ts`.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useMeQuery } from '../../lib/session.js'
import { useT } from '@devon/i18n'
import { toast } from '@devon/ui'
import * as api from './api.js'
import type { Project, ProjectTemplate } from './api.js'

function useCsrfToken(): string {
  const me = useMeQuery().data
  if (!me) throw new Error('useCsrfToken: called with no signed-in session')
  return me.csrfToken
}

const PROJECTS_KEY = ['projects', 'list'] as const
const PROJECT_KEY = (id: string) => ['projects', 'item', id] as const
const TEMPLATES_KEY = ['projects', 'templates'] as const

export function useProjectsQuery(): UseQueryResult<Project[], Error> {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: api.fetchProjects })
}

export function useProjectQuery(id: string | null): UseQueryResult<Project, Error> {
  return useQuery({
    queryKey: PROJECT_KEY(id ?? ''),
    queryFn: () => api.fetchProject(id!),
    enabled: id !== null,
  })
}

export function useTemplatesQuery(): UseQueryResult<ProjectTemplate[], Error> {
  return useQuery({ queryKey: TEMPLATES_KEY, queryFn: api.fetchTemplates })
}

export function useCreateProjectMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: api.CreateProjectInput) => api.createProject(input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export function useCreateFromTemplateMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: api.CreateFromTemplateInput) => api.createFromTemplate(input, csrf),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export function useCreateFromGalleryMutation() {
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: api.CreateFromGalleryInput) => api.createFromGallery(input, csrf),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY })
      void qc.invalidateQueries({ queryKey: ['work'] })
    },
  })
}

export function usePatchProjectMutation(id: string) {
  const t = useT()
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (patch: api.PatchProjectInput) => api.patchProject(id, patch, csrf),
    onError: () => toast(t('projectEdit.error')),
    onSuccess: (project) => {
      qc.setQueryData(PROJECT_KEY(id), project)
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useAddMilestoneMutation(id: string) {
  const t = useT()
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (input: { title: string; dueOn?: string | null; done?: boolean }) =>
      api.addMilestone(id, input, csrf),
    onError: () => toast(t('projectEdit.error')),
    onSuccess: (project) => {
      qc.setQueryData(PROJECT_KEY(id), project)
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function usePatchMilestoneMutation(id: string) {
  const t = useT()
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: ({
      milestoneId,
      patch,
    }: {
      milestoneId: string
      patch: { title?: string; dueOn?: string | null; done?: boolean }
    }) => api.patchMilestone(id, milestoneId, patch, csrf),
    onError: () => toast(t('projectEdit.error')),
    onSuccess: (project) => {
      qc.setQueryData(PROJECT_KEY(id), project)
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useDeleteMilestoneMutation(id: string) {
  const t = useT()
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (milestoneId: string) => api.deleteMilestone(id, milestoneId, csrf),
    onError: () => toast(t('projectEdit.error')),
    onSuccess: (project) => {
      qc.setQueryData(PROJECT_KEY(id), project)
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useDeleteProjectMutation(undo = false) {
  const t = useT()
  const qc = useQueryClient()
  const csrf = useCsrfToken()
  return useMutation({
    mutationFn: (id: string) =>
      undo ? api.undoDeleteProject(id, csrf) : api.deleteProject(id, csrf),
    onError: () => toast(t('projectEdit.error')),
    onSuccess: () => {
      for (const key of ['projects', 'work', 'analytics', 'inbox'])
        void qc.invalidateQueries({ queryKey: [key] })
    },
  })
}
