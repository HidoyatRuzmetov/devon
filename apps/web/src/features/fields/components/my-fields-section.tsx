// "Mening maʼlumotlarim" (v1.1 SPEC §5) -- the member half of custom fields, rendered as one section
// of `/account` and reached by the deep link `/account#fields` that a fill request's inbox row and
// its Telegram button both point at.
//
// What this screen owes the person reading it:
//   * the fields the head is *waiting on* first, marked, so the reason they were sent here is the
//     first thing on screen;
//   * a required field with no answer highlighted, not silently accepted;
//   * one save for the whole form, with the same validation the server runs, so a rejected value is
//     explained next to the control and not as a red banner about "validation_failed";
//   * every one of the five states -- loading, error, empty (the boshqarma defines no fields), no
//     department, offline -- because a xodim reaching this anchor from Telegram may be on a train.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Loader2 } from 'lucide-react'
import { useLocale, useT } from '@devon/i18n'
import {
  Badge,
  Button,
  Celebrate,
  Field,
  SectionCard,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cn,
  toast,
} from '@devon/ui'
import { ApiError } from '../../../lib/api-client.js'
import { useMeQuery } from '../../../lib/session.js'
import { useDepartment } from '../../../lib/session.js'
import { useOnline } from '../../../lib/use-online.js'
import { fetchMyFields, saveMyFields, type MyField, type WireFieldValue } from '../api.js'
import { fieldDescription, fieldLabel, isMissing } from '../format.js'
import { FieldValueInput, checkValue } from './field-value-input.js'

type Draft = Record<string, WireFieldValue>
type SaveCommand = {
  items: { defId: string; value: WireFieldValue }[]
  ownerUserId: string | null
  departmentId: string | null
  csrfToken: string
}

export function MyFieldsSection(): React.JSX.Element | null {
  const t = useT()
  const locale = useLocale()
  const online = useOnline()
  const queryClient = useQueryClient()
  const { departmentId } = useDepartment()
  const meQuery = useMeQuery()
  const csrfToken = meQuery.data?.csrfToken ?? ''

  const query = useQuery({
    queryKey: ['fields', 'me', departmentId],
    queryFn: fetchMyFields,
    enabled: departmentId !== null,
  })

  const [draft, setDraft] = React.useState<Draft>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [justSaved, setJustSaved] = React.useState(false)
  const currentDepartment = React.useRef(departmentId)
  React.useLayoutEffect(() => {
    currentDepartment.current = departmentId
  }, [departmentId])
  const ownsCommand = (command: SaveCommand) =>
    Boolean(
      command.ownerUserId &&
      queryClient.getQueryData<NonNullable<typeof meQuery.data>>(['me'])?.user.id ===
        command.ownerUserId &&
      currentDepartment.current === command.departmentId,
    )

  // The server's answers are the source of truth; the draft only holds what this person has changed
  // since the last load, so a value somebody else edited never silently overwrites theirs.
  const fields = React.useMemo(() => query.data?.fields ?? [], [query.data])
  const valueOf = React.useCallback(
    (field: MyField): WireFieldValue =>
      Object.prototype.hasOwnProperty.call(draft, field.def.id)
        ? (draft[field.def.id] ?? null)
        : field.value,
    [draft],
  )

  const dirtyIds = React.useMemo(
    () =>
      fields
        .filter((f) => Object.prototype.hasOwnProperty.call(draft, f.def.id))
        .map((f) => f.def.id),
    [fields, draft],
  )

  const save = useMutation({
    mutationFn: async (command: SaveCommand) => {
      if (!ownsCommand(command)) throw new Error('The field settings context changed')
      return saveMyFields(command.items, command.csrfToken)
    },
    onSuccess: (data, command) => {
      if (!ownsCommand(command)) return
      queryClient.setQueryData(['fields', 'me', command.departmentId], data)
      void queryClient.invalidateQueries({ queryKey: ['inbox', 'notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['fields', 'defs'] })
      setDraft((current) => {
        const next = { ...current }
        for (const { defId, value } of command.items)
          if (JSON.stringify(next[defId]) === JSON.stringify(value)) delete next[defId]
        return next
      })
      setJustSaved(true)
      toast.success(t('fields.my.saved'))
    },
    onError: (err: unknown, command) => {
      if (!ownsCommand(command)) return
      if (err instanceof ApiError && err.errors.length > 0) {
        toast.error(t(`fields.error.${err.errors[0]!.code}`))
        return
      }
      toast.error(t('fields.my.saveFailed'))
    },
  })

  function change(field: MyField, next: WireFieldValue): void {
    setDraft((current) => ({ ...current, [field.def.id]: next }))
    const code = checkValue(field.def, next)
    setErrors((current) => {
      const copy = { ...current }
      if (code) copy[field.def.id] = code
      else delete copy[field.def.id]
      return copy
    })
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    if (save.isPending) return
    const found: Record<string, string> = {}
    for (const field of fields) {
      if (!field.editable) continue
      const code = checkValue(field.def, valueOf(field))
      if (code) found[field.def.id] = code
    }
    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast.error(t('fields.my.fixErrors'))
      return
    }
    save.mutate({
      items: fields
        .filter((f) => dirtyIds.includes(f.def.id))
        .map((f) => ({ defId: f.def.id, value: valueOf(f) })),
      ownerUserId: meQuery.data?.user.id ?? null,
      departmentId,
      csrfToken,
    })
  }

  // A person with no department has no department fields; the section simply does not exist for them
  // rather than showing an empty card with nothing to say.
  if (departmentId === null) return null

  if (query.isPending) {
    return (
      <SectionCard id="fields" title={t('fields.my.title')} description={t('fields.my.subtitle')}>
        <div className="flex flex-col gap-4" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32 rounded-sm" />
              <Skeleton className="h-11 w-full rounded-sm" />
            </div>
          ))}
        </div>
      </SectionCard>
    )
  }

  if (!online && query.isError) {
    return (
      <SectionCard id="fields" title={t('fields.my.title')}>
        <StateView
          kind="offline"
          compact
          titleKey="state.offline.banner"
          bodyKey="state.offline.empty"
        />
      </SectionCard>
    )
  }

  if (query.isError) {
    return (
      <SectionCard id="fields" title={t('fields.my.title')}>
        <StateView
          kind="error"
          compact
          titleKey="state.error.title"
          bodyKey="state.error.body"
          action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
        />
      </SectionCard>
    )
  }

  if (fields.length === 0) {
    return (
      <SectionCard id="fields" title={t('fields.my.title')} description={t('fields.my.subtitle')}>
        <StateView
          kind="empty"
          compact
          titleKey="fields.my.empty.title"
          bodyKey="fields.my.empty.body"
        />
      </SectionCard>
    )
  }

  const requested = query.data?.openRequests ?? 0
  const missingRequired = fields.filter(
    (f) => f.def.required && isMissing(f.def, valueOf(f)),
  ).length

  return (
    <SectionCard
      id="fields"
      title={t('fields.my.title')}
      description={t('fields.my.subtitle')}
      headerAside={
        requested > 0 ? (
          <Badge tone="warning">{t('fields.my.requestedBadge', { count: requested })}</Badge>
        ) : missingRequired > 0 ? (
          <Badge tone="neutral">{t('fields.my.missingBadge', { count: missingRequired })}</Badge>
        ) : (
          <Badge tone="primary">{t('fields.my.completeBadge')}</Badge>
        )
      }
      actions={
        <span className="relative inline-flex">
          <Celebrate play={justSaved} onDone={() => setJustSaved(false)} />
          <Button
            type="submit"
            form="my-fields-form"
            disabled={dirtyIds.length === 0 || save.isPending}
          >
            {save.isPending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ClipboardList aria-hidden="true" className="size-4" />
            )}
            {t('fields.my.save')}
          </Button>
        </span>
      }
    >
      <form id="my-fields-form" onSubmit={submit} noValidate>
        <Stagger className="flex flex-col gap-5">
          {fields.map((field) => {
            const inputId = `my-field-${field.def.id}`
            const errorCode = errors[field.def.id] ?? null
            const value = valueOf(field)
            const missing = field.def.required && isMissing(field.def, value)
            return (
              <StaggerItem key={field.def.id}>
                <div
                  className={cn(
                    'rounded-sm border p-3 transition-colors duration-(--dur-micro)',
                    field.requested
                      ? 'border-warning/40 bg-warning/5'
                      : missing
                        ? 'border-border bg-muted/30'
                        : 'border-transparent',
                  )}
                >
                  <Field
                    label={`${fieldLabel(field.def, locale)}${field.def.required ? ' *' : ''}`}
                    htmlFor={inputId}
                    {...(fieldDescription(field.def, locale)
                      ? { hint: fieldDescription(field.def, locale) }
                      : {})}
                  >
                    <FieldValueInput
                      id={inputId}
                      def={field.def}
                      value={value}
                      disabled={!field.editable}
                      errorCode={errorCode}
                      onChange={(next) => change(field, next)}
                    />
                  </Field>
                  {errorCode ? (
                    <p
                      id={`${inputId}-error`}
                      role="alert"
                      className="mt-1.5 text-small text-destructive"
                    >
                      {t(`fields.error.${errorCode}`)}
                    </p>
                  ) : null}
                  {field.requested ? (
                    <p className="mt-1.5 text-small text-warning">{t('fields.my.requestedHint')}</p>
                  ) : null}
                  {!field.editable ? (
                    <p className="mt-1.5 text-small text-muted-foreground">
                      {t('fields.my.headOnlyHint')}
                    </p>
                  ) : null}
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      </form>
    </SectionCard>
  )
}

export default MyFieldsSection
