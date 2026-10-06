// `/departments/new` -- the create-request form (TECH-SPEC §2.2) plus the pending-state screen for a
// request already in flight, in one route (no path-param route exists yet for a request id -- see
// MODULE-GUIDE.md "Web features"; this module reads its own request list instead of needing one).
// Rebuilt as UI-OVERHAUL.md's stepper (name -> units -> settings/review) and a status-timeline pending
// state, per this pass's brief for the departments hub.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useT, LOCALES, LOCALE_LABEL, type Locale } from '@devon/i18n'
import { Button, IconButton, Input, PageHeader, Reveal, StateView, cn } from '@devon/ui'
import { fetchMyRequests, createDepartmentRequest, type UnitDraft } from './api.js'
import { useMeQuery } from '../../lib/session.js'
import { PendingRequestView } from './components/pending-request-view.js'

const HEX_SWATCHES = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2']
const STEP_KEYS = ['name', 'units', 'settings'] as const
type Step = (typeof STEP_KEYS)[number]

function StepIndicator({ step }: { step: Step }) {
  const t = useT()
  const index = STEP_KEYS.indexOf(step)
  return (
    // 390 px: three numbered dots plus three full Uzbek labels plus two 32 px rules is 401 px of
    // stepper in a 390 px window, and DESIGN.md's rule is that the page body never scrolls
    // sideways. Below `sm` only the step you are on is named -- which is the only label a stepper is
    // read for anyway -- and the connectors shrink; from `sm` up nothing changes. The names of the
    // other steps stay in the accessible tree either way (`sr-only`), so the list still reads as
    // "Nomi, Boʻlinmalar, Sozlamalar" to a screen reader at every width.
    <ol className="flex items-center gap-1.5 sm:gap-2">
      {STEP_KEYS.map((key, i) => (
        <li key={key} className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-medium transition-colors duration-(--dur-micro)',
              i < index && 'bg-success text-success-foreground',
              i === index && 'bg-primary text-primary-foreground',
              i > index && 'bg-muted text-muted-foreground',
            )}
          >
            {i < index ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
          </span>
          <span
            className={cn(
              'truncate text-small',
              i === index ? 'font-medium text-foreground' : 'text-muted-foreground',
              i === index ? '' : 'sr-only sm:not-sr-only',
            )}
          >
            {t(`departments.create.steps.${key}`)}
          </span>
          {i < STEP_KEYS.length - 1 ? (
            <span className="h-px w-4 shrink-0 bg-border sm:w-8" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  )
}

export default function CreateRequestScreen() {
  const t = useT()
  const queryClient = useQueryClient()
  const meQuery = useMeQuery()
  const requestsQuery = useQuery({
    queryKey: ['departments', 'requests', 'mine'],
    queryFn: fetchMyRequests,
  })

  const [forceForm, setForceForm] = React.useState(false)
  const [step, setStep] = React.useState<Step>('name')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [locale, setLocale] = React.useState<Locale>('uz-Latn')
  const [units, setUnits] = React.useState<UnitDraft[]>([])
  const [nameTouched, setNameTouched] = React.useState(false)

  const mutation = useMutation({
    mutationFn: () =>
      createDepartmentRequest(
        { name, description: description || undefined, units, locale },
        meQuery.data?.csrfToken ?? '',
      ),
    onSuccess: () => {
      setForceForm(false)
      void queryClient.invalidateQueries({
        queryKey: ['departments', 'requests', 'mine'],
      })
    },
  })

  if (requestsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (requestsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => requestsQuery.refetch(),
        }}
      />
    )
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
    setUnits((prev) => [
      ...prev,
      { name: '', colour: HEX_SWATCHES[prev.length % HEX_SWATCHES.length] },
    ])
  }
  function updateUnit(i: number, patch: Partial<UnitDraft>) {
    setUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)))
  }
  function removeUnit(i: number) {
    setUnits((prev) => prev.filter((_, idx) => idx !== i))
  }

  const nameValid = name.trim().length > 0
  const canGoNext = step !== 'name' || nameValid

  const goNext = () => {
    if (step === 'name') {
      if (!nameValid) {
        setNameTouched(true)
        return
      }
      setStep('units')
    } else if (step === 'units') {
      setStep('settings')
    }
  }
  const goBack = () => {
    if (step === 'units') setStep('name')
    else if (step === 'settings') setStep('units')
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Reveal>
        <PageHeader
          eyebrow={t('departments.landing.eyebrow')}
          title={t('departments.create.title')}
          description={t('departments.create.subtitle')}
        />
      </Reveal>

      <div className="rounded-md border border-border bg-card p-6 shadow-1 sm:p-8">
        <StepIndicator step={step} />

        <form
          className="mt-6 flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (step !== 'settings') {
              goNext()
            } else if (!mutation.isPending) {
              mutation.mutate()
            }
          }}
          noValidate
        >
          {step === 'name' ? (
            <Reveal className="flex flex-col gap-4" key="step-name">
              <label className="flex flex-col gap-1.5">
                <span className="text-small text-foreground">{t('departments.create.name')}</span>
                <Input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                  invalid={nameTouched && !nameValid}
                />
                {nameTouched && !nameValid ? (
                  <span className="text-caption text-destructive">
                    {t('structure.units.validation.nameRequired')}
                  </span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-small text-foreground">
                  {t('departments.create.description')}
                </span>
                <textarea
                  className="min-h-24 w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </Reveal>
          ) : null}

          {step === 'units' ? (
            <Reveal className="flex flex-col gap-3" key="step-units">
              <p className="text-small text-muted-foreground">
                {t('departments.create.unitsHint')}
              </p>
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
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-fit"
                onClick={addUnit}
              >
                {t('departments.create.addUnit')}
              </Button>
            </Reveal>
          ) : null}

          {step === 'settings' ? (
            <Reveal className="flex flex-col gap-5" key="step-settings">
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

              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-4">
                <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                  {t('departments.create.reviewTitle')}
                </span>
                <p className="text-body font-medium text-foreground">{name}</p>
                {description ? (
                  <p className="text-small text-muted-foreground">{description}</p>
                ) : null}
                {units.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {units.map((u, i) => (
                      <span
                        key={i}
                        className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-caption font-medium text-foreground"
                      >
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: u.colour ?? undefined }}
                        />
                        {u.name || t('departments.create.unitName')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-small text-muted-foreground">
                    {t('departments.create.noUnitsYet')}
                  </p>
                )}
              </div>
            </Reveal>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-2">
            {step !== 'name' ? (
              <Button type="button" variant="secondary" onClick={goBack}>
                <ChevronLeft className="size-4" aria-hidden="true" />
                {t('departments.create.back')}
              </Button>
            ) : (
              <span />
            )}
            {step !== 'settings' ? (
              <Button type="submit" disabled={!canGoNext}>
                {t('departments.create.next')}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="submit" loading={mutation.isPending}>
                {t('departments.create.submit')}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
