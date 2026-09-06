// Typed API client for the group-projects module (MODULE-GUIDE.md "Web features"), mirroring
// `apps/api/src/modules/projects/schemas.ts` the same way `../work/api.ts` mirrors the work module's.
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'

export const projectStatusSchema = z.enum(['planning', 'active', 'on_hold', 'done', 'archived'])
export type ProjectStatus = z.infer<typeof projectStatusSchema>

export const milestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueOn: z.string().nullable(),
  doneAt: z.string().nullable(),
})
export type Milestone = z.infer<typeof milestoneSchema>

export const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.object({ format: z.literal('markdown'), text: z.string() }).nullable(),
  colour: z.string(),
  coverKey: z.string().nullable(),
  ownerUserId: z.string(),
  members: z.array(z.string()),
  status: projectStatusSchema,
  startOn: z.string().nullable(),
  targetOn: z.string().nullable(),
  milestones: z.array(milestoneSchema),
  progress: z.number(),
  objectiveTotal: z.number().int(),
  objectiveDone: z.number().int(),
  subjectiveTotal: z.number().int(),
  subjectiveDone: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type Project = z.infer<typeof projectSchema>
export const projectListSchema = z.array(projectSchema)

export const templateSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  milestones: z.array(z.object({ title: z.string(), offsetDays: z.number().int() })),
})
export type ProjectTemplate = z.infer<typeof templateSchema>
export const templateListSchema = z.array(templateSchema)

export function fetchProjects(): Promise<Project[]> {
  return apiClient.get('/api/v1/projects', projectListSchema)
}

export function fetchTemplates(): Promise<ProjectTemplate[]> {
  return apiClient.get('/api/v1/projects/templates', templateListSchema)
}

export function fetchProject(id: string): Promise<Project> {
  return apiClient.get(`/api/v1/projects/${encodeURIComponent(id)}`, projectSchema)
}

export type CreateProjectInput = {
  title: string
  description?: string
  colour?: string
  ownerUserId: string
  members: string[]
  status?: ProjectStatus
  startOn?: string
  targetOn?: string
  milestones?: Array<{ title: string; dueOn: string | null }>
}

export function createProject(input: CreateProjectInput, csrfToken: string): Promise<Project> {
  return apiClient.post('/api/v1/projects', input, projectSchema, csrfToken)
}

export type CreateFromTemplateInput = {
  templateKey: string
  title?: string | undefined
  ownerUserId: string
  members: string[]
  startOn?: string | undefined
}

export function createFromTemplate(
  input: CreateFromTemplateInput,
  csrfToken: string,
): Promise<Project> {
  return apiClient.post('/api/v1/projects/from-template', input, projectSchema, csrfToken)
}

export type PatchProjectInput = Partial<{
  title: string
  description: string | null
  colour: string
  ownerUserId: string
  members: string[]
  status: ProjectStatus
  startOn: string | null
  targetOn: string | null
  version: number
}>

export function patchProject(
  id: string,
  patch: PatchProjectInput,
  csrfToken: string,
): Promise<Project> {
  return apiClient.patch(
    `/api/v1/projects/${encodeURIComponent(id)}`,
    patch,
    projectSchema,
    csrfToken,
  )
}

export function addMilestone(
  id: string,
  input: { title: string; dueOn?: string | null },
  csrfToken: string,
): Promise<Project> {
  return apiClient.post(
    `/api/v1/projects/${encodeURIComponent(id)}/milestones`,
    input,
    projectSchema,
    csrfToken,
  )
}

export function patchMilestone(
  id: string,
  milestoneId: string,
  patch: { title?: string; dueOn?: string | null; done?: boolean },
  csrfToken: string,
): Promise<Project> {
  return apiClient.patch(
    `/api/v1/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}`,
    patch,
    projectSchema,
    csrfToken,
  )
}
