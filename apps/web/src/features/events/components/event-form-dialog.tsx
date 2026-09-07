// Create/edit event form (DESIGN.md §3: RequestForm-style dialog; UI-OVERHAUL.md "new-event form as a
// stepper with AI draft preview"). One component for both modes -- `initial` present means "edit",
// absent means "create" -- so the field list never drifts between the two flows. Both modes walk the
// same three-step wizard (Basics -> Schedule & place -> Capacity & reminders); a stepper is still the
// right shape for an edit, since it is the same set of decisions, just pre-filled.
//
// AI wiring (UI-OVERHAUL.md "AI helpers"): a `SparkleButton` on the Basics step runs the AI module's
// `draft_event` feature from a one-line idea and previews the result in an `AiPreviewPanel` --
// Accept/Edit copy the drafted title and description into the form (still fully editable before
// submit), Discard throws the draft away. Nothing is created until the organiser presses the final
// step's submit button (TECH-SPEC §8: "the user always sees a preview and accepts").
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import {
  AiPreviewPanel,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  Input,
  SparkleButton,
  cn,
  toast,
} from '@devon/ui'
import { Check } from 'lucide-react'
import { useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { EVENT_CATEGORIES, type EventDto } from '../schemas.js'
import { Checkbox, Field, Select, Textarea } from './form-controls.js'

export type EventFormValues = {
  title: string
  description: string
  category: string
  startsAt: string
  endsAt: string
  place: string
  placeUrl: string
  capacity: string
  waitlistEnabled: boolean
  rsvpDeadline: string
  costNote: string
  reminderDayBefore: boolean
  reminderHourBefore: boolean
}

const STEPS = ['basics', 'schedule', 'capacity'] as const
type Step = (typeof STEPS)[number]

function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultsFromEvent(event: EventDto | null): EventFormValues {
  const offsets = event?.reminderOffsetsMinutes ?? [1440, 60]
  return {
    title: event?.title ?? '',
    description: event?.description ?? '',
    category: event?.category ?? 'other',
    startsAt: toLocalInputValue(event?.startsAt ?? null),
    endsAt: toLocalInputValue(event?.endsAt ?? null),
    place: event?.place ?? '',
    placeUrl: event?.placeUrl ?? '',
    capacity: event?.capacity != null ? String(event.capacity) : '',
    waitlistEnabled: event?.waitlistEnabled ?? true,
    rsvpDeadline: toLocalInputValue(event?.rsvpDeadline ?? null),
    costNote: event?.costNote ?? '',
    reminderDayBefore: offsets.includes(1440),
    reminderHourBefore: offsets.includes(60),
  }
}

/** The step indicator: numbered discs joined by a line, the done ones checked -- the same shape as
 * every "step 2 of 3" wizard the product is following Jakob's Law for (a checkout, an onboarding
 * flow). Clicking a done or current step jumps back; a future step is not clickable, matching the
 * usual "you can go back, not skip ahead" wizard convention. */
function StepIndicator({
  step,
  labels,
  onJump,
}: {
  step: number
  labels: readonly string[]
  onJump: (index: number) => void
}) {
  return (
    <ol className="flex items-center gap-2">
      {labels.map((label, index) => {
        const done = index < step
        const current = index === step
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <button
              type="button"
              disabled={index > step}
              onClick={() => onJump(index)}
              className={cn(
                'flex items-center gap-2 rounded-full px-1 py-0.5 text-caption font-medium',
                'transition-colors duration-(--dur-micro) ease-out disabled:cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-medium',
                  done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : current
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span className={cn(current ? 'text-foreground' : 'text-muted-foreground')}>
                {label}
              </span>
            </button>
            {index < labels.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn('h-px flex-1', done ? 'bg-primary' : 'bg-border')}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/** The "Draft with AI" affordance: one line in, a full draft out. Create-mode only -- an existing
 * event already has real content, and re-drafting it from scratch is a different feature (not asked
 * for here) than starting one from nothing. */
function AiDraftAssistant({
  category,
  onApply,
}: {
  category: string
  onApply: (fields: { title: string; description: string }) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [idea, setIdea] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const runMutation = useRunAiFeatureMutation('draft_event')

  const draft =
    runMutation.data && typeof runMutation.data.data === 'object' && runMutation.data.data
      ? (runMutation.data.data as {
          title: string
          description: string
          checklist: string[]
          pollOptions: string[]
          carpoolPlan: string
        })
      : undefined

  function handleRun() {
    if (!idea.trim()) return
    setOpen(true)
    runMutation.mutate({ idea: idea.trim(), category, locale })
  }

  function apply() {
    if (draft) onApply({ title: draft.title, description: draft.description })
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label={t('events.form.aiIdeaLabel')}
          htmlFor="event-ai-idea"
          className="min-w-0 flex-1"
        >
          <Input
            id="event-ai-idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={t('events.form.aiIdeaPlaceholder')}
            maxLength={500}
          />
        </Field>
        <SparkleButton
          aria-label={t('events.form.aiDraftButton')}
          label={t('events.form.aiDraftButton')}
          size="md"
          disabled={!idea.trim()}
          loading={runMutation.isPending}
          onClick={handleRun}
        />
      </div>

      {open ? (
        <AiPreviewPanel
          title={t('events.form.aiDraftButton')}
          status={runMutation.isPending ? 'pending' : runMutation.isError ? 'error' : 'ready'}
          pendingLabel={t('events.form.aiDraftPending')}
          errorMessage={t('events.form.aiDraftFailed')}
          acceptLabel={t('events.form.aiDraftAccept')}
          editLabel={t('events.form.aiDraftEdit')}
          discardLabel={t('events.form.aiDraftDiscard')}
          retryLabel={t('events.actions.retry')}
          onRetry={handleRun}
          onAccept={apply}
          onEdit={apply}
          onDiscard={() => setOpen(false)}
          {...(runMutation.data
            ? { costLine: t('ai.result.tokens', { count: runMutation.data.meta.totalTokens }) }
            : {})}
        >
          {draft ? (
            <div className="flex flex-col gap-2">
              <p className="font-medium text-foreground">{draft.title}</p>
              <p className="whitespace-pre-wrap">{draft.description}</p>
              {draft.checklist.length > 0 ? (
                <div>
                  <p className="text-caption font-medium text-muted-foreground">
                    {t('events.form.aiDraftChecklist')}
                  </p>
                  <ul className="list-inside list-disc text-small text-muted-foreground">
                    {draft.checklist.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {draft.pollOptions.length > 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t('events.form.aiDraftPoll', { options: draft.pollOptions.join(', ') })}
                </p>
              ) : null}
              <p className="text-caption text-muted-foreground">
                {t('events.form.aiDraftFollowUp')}
              </p>
            </div>
          ) : null}
        </AiPreviewPanel>
      ) : null}
    </div>
  )
}

export function EventFormDialog({
  open,
  onOpenChange,
  event,
  onSubmit,
  submitting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` for create; the event being edited otherwise. */
  event: EventDto | null
  onSubmit(values: EventFormValues): Promise<void>
  submitting: boolean
}) {
  const t = useT()
  const [values, setValues] = React.useState<EventFormValues>(() => defaultsFromEvent(event))
  const [error, setError] = React.useState<string | null>(null)
  const [step, setStep] = React.useState(0)

  React.useEffect(() => {
    if (open) {
      setValues(defaultsFromEvent(event))
      setError(null)
      setStep(0)
    }
  }, [open, event])

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const stepLabels: Record<Step, string> = {
    basics: t('events.form.stepBasics'),
    schedule: t('events.form.stepSchedule'),
    capacity: t('events.form.stepCapacity'),
  }
  const currentStep = STEPS[step]!
  const lastStep = step === STEPS.length - 1

  function canAdvance(): boolean {
    if (currentStep === 'basics') return values.title.trim().length > 0
    if (currentStep === 'schedule') return values.startsAt !== '' && values.endsAt !== ''
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!values.title.trim() || !values.startsAt || !values.endsAt) return
    if (new Date(values.endsAt).getTime() <= new Date(values.startsAt).getTime()) {
      setError(t('events.form.validation.endsBeforeStarts'))
      setStep(STEPS.indexOf('schedule'))
      return
    }
    try {
      await onSubmit(values)
      onOpenChange(false)
      toast(t(event ? 'events.actions.save' : 'events.actions.create'))
    } catch {
      setError(t('events.error.title'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t(event ? 'events.actions.edit' : 'events.actions.create')}
        className="max-w-140 max-h-[85vh] overflow-y-auto"
      >
        <div className="mt-4">
          <StepIndicator step={step} labels={STEPS.map((s) => stepLabels[s])} onJump={setStep} />
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          {currentStep === 'basics' ? (
            <>
              {!event ? (
                <AiDraftAssistant
                  category={values.category}
                  onApply={({ title, description }) => {
                    set('title', title)
                    set('description', description)
                  }}
                />
              ) : null}

              <Field label={t('events.form.titleLabel')} htmlFor="event-title">
                <Input
                  id="event-title"
                  value={values.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder={t('events.form.titlePlaceholder')}
                  maxLength={200}
                  required
                />
              </Field>

              <Field label={t('events.form.descriptionLabel')} htmlFor="event-description">
                <Textarea
                  id="event-description"
                  rows={3}
                  value={values.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder={t('events.form.descriptionPlaceholder')}
                  maxLength={5000}
                />
              </Field>

              <Field label={t('events.form.categoryLabel')} htmlFor="event-category">
                <Select
                  id="event-category"
                  value={values.category}
                  onChange={(e) => set('category', e.target.value)}
                  options={EVENT_CATEGORIES.map((c) => ({
                    value: c,
                    label: t(`events.category.${c}`),
                  }))}
                />
              </Field>
            </>
          ) : null}

          {currentStep === 'schedule' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('events.form.startsAtLabel')} htmlFor="event-starts">
                  <Input
                    id="event-starts"
                    type="datetime-local"
                    value={values.startsAt}
                    onChange={(e) => set('startsAt', e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('events.form.endsAtLabel')} htmlFor="event-ends">
                  <Input
                    id="event-ends"
                    type="datetime-local"
                    value={values.endsAt}
                    onChange={(e) => set('endsAt', e.target.value)}
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('events.form.placeLabel')} htmlFor="event-place">
                  <Input
                    id="event-place"
                    value={values.place}
                    onChange={(e) => set('place', e.target.value)}
                    placeholder={t('events.form.placePlaceholder')}
                  />
                </Field>
                <Field label={t('events.form.placeUrlLabel')} htmlFor="event-place-url">
                  <Input
                    id="event-place-url"
                    type="url"
                    value={values.placeUrl}
                    onChange={(e) => set('placeUrl', e.target.value)}
                  />
                </Field>
              </div>
            </>
          ) : null}

          {currentStep === 'capacity' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('events.form.capacityLabel')} htmlFor="event-capacity">
                  <Input
                    id="event-capacity"
                    type="number"
                    min={1}
                    value={values.capacity}
                    onChange={(e) => set('capacity', e.target.value)}
                    placeholder={t('events.form.capacityPlaceholder')}
                  />
                </Field>
                <Field label={t('events.form.rsvpDeadlineLabel')} htmlFor="event-deadline">
                  <Input
                    id="event-deadline"
                    type="datetime-local"
                    value={values.rsvpDeadline}
                    onChange={(e) => set('rsvpDeadline', e.target.value)}
                  />
                </Field>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="event-waitlist"
                  checked={values.waitlistEnabled}
                  onCheckedChange={(v) => set('waitlistEnabled', v)}
                />
                <label htmlFor="event-waitlist" className="text-small text-foreground">
                  {t('events.form.waitlistEnabledLabel')}
                </label>
              </div>

              <Field label={t('events.form.costNoteLabel')} htmlFor="event-cost">
                <Input
                  id="event-cost"
                  value={values.costNote}
                  onChange={(e) => set('costNote', e.target.value)}
                  placeholder={t('events.form.costNotePlaceholder')}
                />
              </Field>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-small font-medium text-foreground">
                  {t('events.form.remindersLabel')}
                </legend>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="event-reminder-day"
                    checked={values.reminderDayBefore}
                    onCheckedChange={(v) => set('reminderDayBefore', v)}
                  />
                  <label htmlFor="event-reminder-day" className="text-small text-foreground">
                    {t('events.form.reminderDayBefore')}
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="event-reminder-hour"
                    checked={values.reminderHourBefore}
                    onCheckedChange={(v) => set('reminderHourBefore', v)}
                  />
                  <label htmlFor="event-reminder-hour" className="text-small text-foreground">
                    {t('events.form.reminderHourBefore')}
                  </label>
                </div>
              </fieldset>
            </>
          ) : null}

          {error ? <p className="text-small text-destructive">{error}</p> : null}

          <div className="flex justify-between gap-2 pt-2">
            {step > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
                {t('events.form.stepBack')}
              </Button>
            ) : (
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {t('events.actions.close')}
                </Button>
              </DialogClose>
            )}
            {lastStep ? (
              <Button type="submit" loading={submitting}>
                {t(event ? 'events.form.submitUpdate' : 'events.form.submitCreate')}
              </Button>
            ) : (
              <Button type="button" disabled={!canAdvance()} onClick={() => setStep((s) => s + 1)}>
                {t('events.form.stepNext')}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
