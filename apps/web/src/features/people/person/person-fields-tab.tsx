// The person page's "Maydonlar" tab (v1.1 SPEC §6): the department's own custom fields for this
// person, with the missing ones highlighted and a head-only "soʻrash" button that triggers
// notify-to-fill for that one field.
//
// This tab is built against `CustomFieldsPort` in `@devon/contracts` (MODULE-GUIDE.md's v1.1 §3:
// "the people table, the card detail property column, the person page and the Mini App's Maydonlar
// screen are built against that port; the `fields` module implements it"). The `fields` module is a
// sibling package in this round, so this file talks to its declared HTTP surface and treats a `404`
// or `not_found` as "the field manager has no person fields here yet" -- a designed empty state that
// teaches the next action, not an error and not a blank panel. Once that module lands the same code
// renders real values with no change.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useLocale, useT } from '@devon/i18n'
import { Badge, Button, Card, Skeleton, StateView, cn, toast } from '@devon/ui'
import { BellRing, CircleAlert } from 'lucide-react'
import { ApiError, apiClient } from '../../../lib/api-client.js'
import { useCsrfToken } from '../hooks.js'

const fieldDefSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).nullable().optional(),
  type: z.string(),
  required: z.boolean(),
  visibleTo: z.enum(['everyone', 'head_only']).optional(),
  selfEditable: z.boolean().optional(),
  order: z.number().optional(),
})
type FieldDefDto = z.infer<typeof fieldDefSchema>

const fieldValueSchema = z.object({
  defId: z.string(),
  subjectId: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  updatedAt: z.string().nullable().optional(),
})
type FieldValueDto = z.infer<typeof fieldValueSchema>

const defsResponse = z.object({ defs: z.array(fieldDefSchema) })
const valuesResponse = z.object({ values: z.array(fieldValueSchema) })

/** `null` means "the fields module is not answering here yet" -- deliberately distinct from an empty
 * list, which means "the head has not created any person fields". */
async function loadDefs(): Promise<FieldDefDto[] | null> {
  try {
    const result = await apiClient.get('/api/v1/fields/defs?appliesTo=person', defsResponse)
    return result.defs
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'not_found' || error.status === 404))
      return null
    throw error
  }
}

async function loadValues(userId: string): Promise<FieldValueDto[] | null> {
  try {
    const result = await apiClient.get(
      `/api/v1/fields/values?appliesTo=person&subjectIds=${encodeURIComponent(userId)}`,
      valuesResponse,
    )
    return result.values
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'not_found' || error.status === 404))
      return null
    throw error
  }
}

function labelOf(def: FieldDefDto, locale: string): string {
  return def.label[locale] ?? def.label['uz-Latn'] ?? def.key
}

function renderValue(value: FieldValueDto['value']): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : null
  if (typeof value === 'boolean') return value ? '✓' : '—'
  return String(value)
}

export function PersonFieldsTab({
  userId,
  canManage,
  canEditOwn,
}: {
  userId: string
  canManage: boolean
  canEditOwn: boolean
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const csrf = useCsrfToken()
  const queryClient = useQueryClient()

  const defsQuery = useQuery({ queryKey: ['fields', 'defs', 'person'], queryFn: loadDefs })
  const valuesQuery = useQuery({
    queryKey: ['fields', 'values', 'person', userId],
    queryFn: () => loadValues(userId),
    enabled: Boolean(defsQuery.data),
  })

  const askToFill = useMutation({
    mutationFn: (defId: string) =>
      apiClient.post('/api/v1/fields/requests', { defId }, z.unknown(), csrf),
    onSuccess: () => {
      toast.success(t('people.person.fields.asked'))
      void queryClient.invalidateQueries({ queryKey: ['fields', 'values', 'person', userId] })
    },
    onError: () => toast.error(t('people.person.fields.askFailed')),
  })

  if (defsQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-sm" />
        ))}
      </div>
    )
  }

  if (defsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => void defsQuery.refetch() }}
      />
    )
  }

  const defs = defsQuery.data
  if (defs === null || defs === undefined) {
    return (
      <StateView
        kind="empty"
        titleKey="people.person.fields.unavailable.title"
        bodyKey="people.person.fields.unavailable.body"
      />
    )
  }
  if (defs.length === 0) {
    return (
      <StateView
        kind="empty"
        titleKey="people.person.fields.empty.title"
        bodyKey="people.person.fields.empty.body"
      />
    )
  }

  const values = new Map((valuesQuery.data ?? []).map((v) => [v.defId, v]))
  const ordered = [...defs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const missingRequired = ordered.filter(
    (def) => def.required && renderValue(values.get(def.id)?.value ?? null) === null,
  ).length

  return (
    <div className="flex flex-col gap-3">
      {missingRequired > 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-small">
          <CircleAlert aria-hidden="true" className="size-4 text-warning" />
          {t('people.person.fields.missingCount', { count: missingRequired })}
        </p>
      ) : null}

      <Card elevation="flat" className="flex flex-col gap-1">
        <dl className="flex flex-col">
          {ordered.map((def) => {
            const shown = renderValue(values.get(def.id)?.value ?? null)
            return (
              <div
                key={def.id}
                className={cn(
                  'flex min-h-11 flex-wrap items-center gap-2 border-b border-border py-2 last:border-0',
                )}
              >
                <dt className="min-w-40 text-small text-muted-foreground">
                  {labelOf(def, locale)}
                  {def.required ? (
                    <Badge variant="subtle" tone="warning" className="ml-2">
                      {t('people.person.fields.required')}
                    </Badge>
                  ) : null}
                </dt>
                <dd className={cn('flex-1 text-small', shown === null && 'text-muted-foreground')}>
                  {shown ?? t('people.person.fields.missing')}
                </dd>
                {shown === null && canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={askToFill.isPending}
                    onClick={() => askToFill.mutate(def.id)}
                  >
                    <BellRing aria-hidden="true" className="size-4" />
                    {t('people.person.fields.ask')}
                  </Button>
                ) : null}
                {shown === null && canEditOwn && !canManage ? (
                  <Button asChild variant="ghost" size="sm">
                    <a href="/account#fields">{t('people.person.fields.fillOwn')}</a>
                  </Button>
                ) : null}
              </div>
            )
          })}
        </dl>
      </Card>
    </div>
  )
}
