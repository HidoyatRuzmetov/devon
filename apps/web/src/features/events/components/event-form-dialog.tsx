// Create/edit event form (DESIGN.md §3: RequestForm-style dialog). One component for both modes --
// `initial` present means "edit", absent means "create" -- so the field list never drifts between the
// two flows.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogClose, DialogContent, toast } from '@devon/ui'
import { EVENT_CATEGORIES, type EventDto } from '../schemas.js'
import { Checkbox, Field, Select, Textarea } from './form-controls.js'
import { Input } from '@devon/ui'

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

  React.useEffect(() => {
    if (open) {
      setValues(defaultsFromEvent(event))
      setError(null)
    }
  }, [open, event])

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!values.title.trim() || !values.startsAt || !values.endsAt) return
    if (new Date(values.endsAt).getTime() <= new Date(values.startsAt).getTime()) {
      setError(t('events.form.validation.endsBeforeStarts'))
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
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
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

          {error ? <p className="text-small text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t('events.actions.close')}
              </Button>
            </DialogClose>
            <Button type="submit" loading={submitting}>
              {t(event ? 'events.form.submitUpdate' : 'events.form.submitCreate')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
