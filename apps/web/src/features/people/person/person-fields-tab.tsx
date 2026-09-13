// The person page's "Maydonlar" tab (v1.1 SPEC §6): the department's own custom fields for this
// person, with the missing ones highlighted and a head-only "soʻrash" button that triggers
// notify-to-fill for that one field, for this one person.
//
// **v1.1 critique SEV1 #2.** This tab used to call `/fields/values?appliesTo=person&subjectIds=<user
// id>` and then match the answers by `subjectId`. Both halves were wrong in the same direction, so
// they hid each other: `appliesTo` is not a parameter this endpoint has (`subjectType` is), and a
// person value hangs off the **membership**, so `subjectId` is a membership id and can never equal a
// user id. Every field therefore rendered as "Toʻldirilmagan" and the amber "N ta majburiy maydon
// toʻldirilmagan" banner fired for people who had answered -- on the page built to show compliance,
// with per-row buttons that would have sent pointless Telegram requests. The fix is to ask by
// `userIds` (the server resolves the membership) and to match on `subjectUserId`, the field the DTO
// has carried all along. `person-fields-tab.golden.test.tsx` asserts both halves stay fixed.
//
// This tab is built against `CustomFieldsPort` in `@devon/contracts` (MODULE-GUIDE.md's v1.1 §3) and
// talks to the `fields` module's declared HTTP surface, treating a `404`/`not_found` as "no person
// fields configured here yet" -- a designed empty state, not an error and not a blank panel.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useT } from '@devon/i18n'
import { Badge, Button, Card, Skeleton, StateView, cn, toast } from '@devon/ui'
import { BellRing, CircleAlert } from 'lucide-react'
import { ApiError } from '../../../lib/api-client.js'
import {
  fetchDefs,
  fetchValues,
  notifyToFill,
  type FieldDefDto,
  type FieldValueRecordDto,
} from '../../fields/api.js'
import { fieldLabel } from '../../fields/format.js'
import { useCsrfToken } from '../hooks.js'

/** `null` means "the fields module is not answering here yet" -- deliberately distinct from an empty
 * list, which means "the head has not created any person fields". */
async function loadDefs(): Promise<FieldDefDto[] | null> {
  try {
    const result = await fetchDefs('person')
    return result.defs.filter((def) => def.archivedAt === null)
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'not_found' || error.status === 404))
      return null
    throw error
  }
}

async function loadValues(userId: string): Promise<FieldValueRecordDto[] | null> {
  try {
    const result = await fetchValues({ subjectType: 'person', userIds: [userId] })
    // The server already scopes this, but the tab never trusts a wider answer than it asked for.
    return result.values.filter((v) => v.subjectUserId === userId)
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'not_found' || error.status === 404))
      return null
    // A member who somehow reaches a colleague's page gets the designed no-permission state, not a
    // crash -- the server is the one that decides, and it just did.
    if (error instanceof ApiError && (error.code === 'forbidden' || error.status === 403))
      return null
    throw error
  }
}

function renderValue(value: FieldValueRecordDto['value']): string | null {
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
    queryKey: ['fields', 'values', 'person', 'one', userId],
    queryFn: () => loadValues(userId),
    enabled: Boolean(defsQuery.data),
  })

  const askToFill = useMutation({
    // Scoped to this person: the head is looking at Nodira's page, so only Nodira is asked.
    mutationFn: (defId: string) => notifyToFill(defId, csrf, [userId]),
    onSuccess: (result) => {
      toast.success(
        result.asked > 0 ? t('people.person.fields.asked') : t('people.person.fields.reminded'),
      )
      void queryClient.invalidateQueries({ queryKey: ['fields', 'values', 'person'] })
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

  // SEV1 #2: keyed by `subjectUserId`, not `subjectId`. While the answers are still loading nothing
  // is declared missing -- a pending query must never look like a compliance failure.
  const loaded = valuesQuery.data !== undefined && !valuesQuery.isPending
  const values = new Map(
    (valuesQuery.data ?? []).filter((v) => v.subjectUserId === userId).map((v) => [v.defId, v]),
  )
  const ordered = [...defs].sort((a, b) => a.order - b.order)
  const missingRequired = loaded
    ? ordered.filter(
        (def) => def.required && renderValue(values.get(def.id)?.value ?? null) === null,
      ).length
    : 0

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
            const shown = loaded ? renderValue(values.get(def.id)?.value ?? null) : null
            return (
              <div
                key={def.id}
                className={cn(
                  'flex min-h-11 flex-wrap items-center gap-2 border-b border-border py-2 last:border-0',
                )}
              >
                <dt className="min-w-40 text-small text-muted-foreground">
                  {fieldLabel(def, locale)}
                  {def.required ? (
                    <Badge variant="subtle" tone="warning" className="ml-2">
                      {t('people.person.fields.required')}
                    </Badge>
                  ) : null}
                </dt>
                <dd className={cn('flex-1 text-small', shown === null && 'text-muted-foreground')}>
                  {!loaded ? (
                    <Skeleton className="h-4 w-24 rounded-sm" />
                  ) : (
                    (shown ?? t('people.person.fields.missing'))
                  )}
                </dd>
                {loaded && shown === null && canManage ? (
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
                {loaded && shown === null && canEditOwn && !canManage ? (
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
