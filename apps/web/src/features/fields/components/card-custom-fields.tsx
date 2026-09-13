// Card custom fields for the card detail's property column (v1.1 SPEC §5).
//
// **Merge note.** This component belongs to the `fields` feature but is rendered by
// `apps/web/src/features/work/components/card-detail.tsx` (one import, one line at the end of the
// property list) -- the single edit this package makes outside its own folder on the web side,
// because a card field nobody can see on a card is not a card field. If that file is rewritten in
// the merge, keep those two lines:
//
//     import { CardCustomFields } from '../../fields/index.js'
//     <CardCustomFields cardId={card.id} ownerUserIds={[giver, assignee, creator]} />
//
// Behaviour the spec asks for and this component implements: the head's order, inline editing that
// saves on blur (a property column is not a form with a Save button), a required card field that is
// still empty shown as blocking, and the five states.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useLocale, useT } from '@devon/i18n'
import { Skeleton, StateView, cn, toast } from '@devon/ui'
import { ApiError } from '../../../lib/api-client.js'
import { useCan } from '../../../lib/can.js'
import { useMeQuery } from '../../../lib/session.js'
import { useOnline } from '../../../lib/use-online.js'
import { fetchDefs, fetchValues, setValue, type FieldDefDto, type WireFieldValue } from '../api.js'
import { fieldDescription, fieldLabel, isMissing } from '../format.js'
import { FieldValueDisplay, FieldValueInput, checkValue } from './field-value-input.js'

export type CardCustomFieldsProps = {
  cardId: string
  /** The card's owner set (giver, assignee, creator). Passed straight to `useCan` so the exact
   * object question is asked, not the capability one. */
  ownerUserIds?: readonly string[] | null
  className?: string
}

export function CardCustomFields({
  cardId,
  ownerUserIds = null,
  className,
}: CardCustomFieldsProps): React.JSX.Element | null {
  const t = useT()
  const locale = useLocale()
  const online = useOnline()
  const queryClient = useQueryClient()
  const csrfToken = useMeQuery().data?.csrfToken ?? ''
  const canEdit = useCan('fields.value.editOnCard', { ownerUserIds })

  const defsQuery = useQuery({
    queryKey: ['fields', 'defs', 'card'],
    queryFn: () => fetchDefs('card'),
  })
  const valuesQuery = useQuery({
    queryKey: ['fields', 'values', 'card', cardId],
    queryFn: () => fetchValues({ subjectType: 'card', subjectIds: [cardId] }),
    enabled: Boolean(cardId),
  })

  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<WireFieldValue>(null)
  const [errorCode, setErrorCode] = React.useState<string | null>(null)

  const defs = React.useMemo(
    () => (defsQuery.data?.defs ?? []).filter((d) => d.archivedAt === null),
    [defsQuery.data],
  )
  const values = React.useMemo(() => {
    const map = new Map<string, WireFieldValue>()
    for (const v of valuesQuery.data?.values ?? []) map.set(v.defId, v.value)
    return map
  }, [valuesQuery.data])

  const save = useMutation({
    mutationFn: (input: { defId: string; value: WireFieldValue }) =>
      setValue({ defId: input.defId, subjectId: cardId, value: input.value }, csrfToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fields', 'values', 'card', cardId] })
      void queryClient.invalidateQueries({ queryKey: ['work'] })
      toast.success(t('fields.card.saved'))
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.errors.length > 0) {
        toast.error(t(`fields.error.${err.errors[0]!.code}`))
        return
      }
      toast.error(t('fields.card.saveFailed'))
    },
  })

  function beginEdit(def: FieldDefDto): void {
    if (!canEdit.allowed || def.type === 'derived') return
    setEditingId(def.id)
    setDraft(values.get(def.id) ?? null)
    setErrorCode(null)
  }

  function commit(def: FieldDefDto): void {
    const code = checkValue(def, draft)
    if (code) {
      setErrorCode(code)
      return
    }
    setEditingId(null)
    setErrorCode(null)
    if (JSON.stringify(draft ?? null) === JSON.stringify(values.get(def.id) ?? null)) return
    save.mutate({ defId: def.id, value: draft })
  }

  if (defsQuery.isPending || valuesQuery.isPending) {
    return (
      <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
        <Skeleton className="h-4 w-24 rounded-sm" />
        <Skeleton className="h-9 w-full rounded-sm" />
      </div>
    )
  }

  if (defsQuery.isError || valuesQuery.isError) {
    return (
      <div className={className}>
        <StateView
          kind={online ? 'error' : 'offline'}
          compact
          titleKey={online ? 'state.error.title' : 'state.offline.banner'}
          bodyKey={online ? 'state.error.body' : 'state.offline.empty'}
          action={{ labelKey: 'state.error.action', onAction: () => void valuesQuery.refetch() }}
        />
      </div>
    )
  }

  // No card fields defined: the property column simply does not grow an empty heading.
  if (defs.length === 0) return null

  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label={t('fields.card.title')}>
      <h3 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {t('fields.card.title')}
      </h3>
      <dl className="flex flex-col gap-2.5">
        {defs.map((def) => {
          const value = values.get(def.id) ?? null
          const editing = editingId === def.id
          const blocking = def.required && isMissing(def, value)
          const inputId = `card-field-${def.id}`
          return (
            <div key={def.id} className="grid grid-cols-[minmax(0,7rem)_1fr] items-start gap-2">
              <dt
                className="pt-1.5 text-small text-muted-foreground"
                title={fieldDescription(def, locale) || undefined}
              >
                {fieldLabel(def, locale)}
                {def.required ? <span aria-hidden="true"> *</span> : null}
              </dt>
              <dd className="min-w-0">
                {editing ? (
                  <div className="flex flex-col gap-1">
                    <FieldValueInput
                      id={inputId}
                      def={def}
                      value={draft}
                      errorCode={errorCode}
                      onChange={setDraft}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-small text-accent-foreground underline underline-offset-2"
                        onClick={() => commit(def)}
                      >
                        {t('fields.card.apply')}
                      </button>
                      <button
                        type="button"
                        className="text-small text-muted-foreground underline underline-offset-2"
                        onClick={() => {
                          setEditingId(null)
                          setErrorCode(null)
                        }}
                      >
                        {t('fields.card.cancel')}
                      </button>
                      {save.isPending ? (
                        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                      ) : null}
                    </div>
                    {errorCode ? (
                      <p
                        id={`${inputId}-error`}
                        role="alert"
                        className="text-small text-destructive"
                      >
                        {t(`fields.error.${errorCode}`)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!canEdit.allowed || def.type === 'derived'}
                    onClick={() => beginEdit(def)}
                    className={cn(
                      'w-full rounded-sm px-1.5 py-1 text-left',
                      'transition-colors duration-(--dur-micro) ease-out',
                      'hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      'disabled:cursor-default disabled:hover:bg-transparent',
                    )}
                    aria-label={t('fields.card.editAria', { field: fieldLabel(def, locale) })}
                  >
                    <FieldValueDisplay def={def} value={value} />
                  </button>
                )}
                {blocking ? (
                  <p className="mt-1 flex items-center gap-1.5 text-small text-warning">
                    <AlertTriangle aria-hidden="true" className="size-3.5" />
                    {t('fields.card.requiredBlocksDone')}
                  </p>
                ) : null}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

export default CardCustomFields
