// `/departments/new` -- the create-request form (TECH-SPEC §2.2) plus the pending-state screen for a
// request already in flight, in one route (no path-param route exists yet for a request id -- see
// MODULE-GUIDE.md "Web features"; this module reads its own request list instead of needing one).
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useT, LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { Badge, Button, IconButton, Input, StateView } from '@devon/ui'
import { fetchMyRequests, createDepartmentRequest, type UnitDraft } from './api.js'
import { useMeQuery } from '../../lib/session.js'

const HEX_SWATCHES = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2']

function PendingRequestView({
  status,
  name,
  reason,
  onCreateAnother,
}: {
  status: 'pending' | 'approved' | 'rejected'
  name: string
  reason: string | null
  onCreateAnother: () => void
}) {
  const t = useT()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <Badge tone={status === 'approved' ? 'success' : status === 'rejected' ? 'destructive' : 'neutral'}>
        {t(`departments.pending.status.${status}`)}
      </Badge>
      <h1 className="text-h2 text-foreground">{t('departments.pending.title')}</h1>
      <p className="text-small text-muted-foreground">"{name}" — {t('departments.pending.body')}</p>
      {status === 'rejected' && reason ? (
        <p className="text-small text-foreground">
          {t('departments.pending.reasonLabel')}: {reason}
        </p>
      ) : null}
      {status === 'rejected' ? (
        <Button size="sm" variant="secondary" onClick={onCreateAnother}>
          {t('departments.pending.createAnother')}
        </Button>
      ) : null}
    </div>
  )
}

export default function CreateRequestScreen() {
  const t = useT()
  const queryClient = useQueryClient()
  const meQuery = useMeQuery()
  const requestsQuery = useQuery({ queryKey: ['departments', 'requests', 'mine'], queryFn: fetchMyRequests })

  const [forceForm, setForceForm] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [locale, setLocale] = React.useState<Locale>('uz-Latn')
  const [units, setUnits] = React.useState<UnitDraft[]>([])

  const mutation = useMutation({
    mutationFn: () =>
      createDepartmentRequest(
        { name, description: description || undefined, units, locale },
        meQuery.data?.csrfToken ?? '',
      ),
    onSuccess: () => {
      setForceForm(false)
      void queryClient.invalidateQueries({ queryKey: ['departments', 'requests', 'mine'] })
    },
  })

  if (requestsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (requestsQuery.isError) {
    return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  }

  const latest = requestsQuery.data.requests[0]
  const showPending = latest && latest.status !== 'rejected' && !forceForm
  const showRejected = latest && latest.status === 'rejected' && !forceForm

  if (showPending) {
    return (
      <PendingRequestView
        status={latest.status}
        name={latest.name}
        reason={latest.reason}
        onCreateAnother={() => setForceForm(true)}
      />
    )
  }
  if (showRejected) {
    return (
      <PendingRequestView
        status="rejected"
        name={latest.name}
        reason={latest.reason}
        onCreateAnother={() => setForceForm(true)}
      />
    )
  }

  function addUnit() {
    setUnits((prev) => [...prev, { name: '', colour: HEX_SWATCHES[prev.length % HEX_SWATCHES.length] }])
  }
  function updateUnit(i: number, patch: Partial<UnitDraft>) {
    setUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)))
  }
  function removeUnit(i: number) {
    setUnits((prev) => prev.filter((_, idx) => idx !== i))
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 rounded-md border border-border bg-card p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-foreground">{t('departments.create.title')}</h1>
        <p className="text-small text-muted-foreground">{t('departments.create.subtitle')}</p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!mutation.isPending) mutation.mutate()
        }}
        noValidate
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('departments.create.name')}</span>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('departments.create.description')}</span>
          <textarea
            className="min-h-20 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-small text-foreground">{t('departments.create.unitsTitle')}</span>
          {units.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                className="size-9 shrink-0 rounded-sm border border-border bg-card"
                value={u.colour ?? '#2563eb'}
                onChange={(e) => updateUnit(i, { colour: e.target.value })}
                aria-label={t('departments.create.unitColour')}
              />
              <Input
                placeholder={t('departments.create.unitName')}
                value={u.name}
                onChange={(e) => updateUnit(i, { name: e.target.value })}
              />
              <IconButton
                type="button"
                aria-label={t('departments.create.removeUnit')}
                onClick={() => removeUnit(i)}
              >
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={addUnit}>
            {t('departments.create.addUnit')}
          </Button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-small text-foreground">{t('departments.create.locale')}</span>
          <select
            className="h-11 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABEL[l]}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" size="lg" loading={mutation.isPending}>
          {t('departments.create.submit')}
        </Button>
      </form>
    </div>
  )
}
