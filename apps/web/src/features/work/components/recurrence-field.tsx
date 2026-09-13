// v1.1 SPEC §7 (A7) -- the repeat rule on a card.
//
// The one thing people get wrong about recurring tasks is *when* the next one appears, so the two
// modes are the first choice the editor offers, in words rather than jargon: "on the schedule
// whatever happens" (a Friday report stays a Friday report even if you miss a week) versus "once
// this one is done" (the 30-day register review, where the clock starts when the work happened).
// `recurrenceRuleSchema` and `nextOccurrence` are the shared rules from `@devon/contracts` -- the job
// that actually creates the next card runs the same function this preview shows.
import * as React from 'react'
import { Repeat } from 'lucide-react'
import {
  nextOccurrence,
  recurrenceRuleSchema,
  type RecurrenceFreq,
  type RecurrenceMode,
  type RecurrenceRule,
} from '@devon/contracts'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Button, Field, Input, RadioGroup, RadioOption, Select, cn, toast } from '@devon/ui'

const FREQ_OPTIONS: readonly RecurrenceFreq[] = ['daily', 'weekly', 'monthly']
const FREQ_LABEL_KEY: Record<RecurrenceFreq, string> = {
  daily: 'work.recurrence.freq.daily',
  weekly: 'work.recurrence.freq.weekly',
  monthly: 'work.recurrence.freq.monthly',
}

/** ISO weekday numbers, Monday first -- the week a Uzbek government department runs on. */
const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7]
const WEEKDAY_LABEL_KEY: Record<number, string> = {
  1: 'work.recurrence.weekday.mon',
  2: 'work.recurrence.weekday.tue',
  3: 'work.recurrence.weekday.wed',
  4: 'work.recurrence.weekday.thu',
  5: 'work.recurrence.weekday.fri',
  6: 'work.recurrence.weekday.sat',
  7: 'work.recurrence.weekday.sun',
}

export const DEFAULT_RECURRENCE: RecurrenceRule = {
  freq: 'weekly',
  interval: 1,
  mode: 'schedule',
  weekdays: [1],
}

export interface RecurrenceFieldProps {
  value: RecurrenceRule | null
  onCommit: (rule: RecurrenceRule | null) => void
  /** The card's own due date -- the preview counts the next occurrence from it, exactly as the job
   * does, so "keyingi: 19.09.2026" on screen is the date that will actually be created. */
  anchorIso: string | null
  disabled?: boolean
}

export function RecurrenceField({
  value,
  onCommit,
  anchorIso,
  disabled = false,
}: RecurrenceFieldProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const fieldId = React.useId()
  const [draft, setDraft] = React.useState<RecurrenceRule | null>(value)

  React.useEffect(() => setDraft(value), [value])

  const editing = draft !== null

  function update(patch: Partial<RecurrenceRule>): void {
    setDraft((prev) => ({ ...(prev ?? DEFAULT_RECURRENCE), ...patch }))
  }

  function save(): void {
    if (draft === null) {
      onCommit(null)
      return
    }
    const parsed = recurrenceRuleSchema.safeParse(draft)
    if (!parsed.success) {
      // The editor's own controls cannot normally produce an invalid rule; this catches the one case
      // they can (a weekly rule with every weekday unticked) with a sentence rather than a 422.
      toast.error(t('work.recurrence.invalid'))
      return
    }
    onCommit(parsed.data)
  }

  const preview = React.useMemo(() => {
    if (draft === null) return null
    const parsed = recurrenceRuleSchema.safeParse(draft)
    if (!parsed.success) return null
    const from = anchorIso ? new Date(anchorIso) : new Date()
    if (Number.isNaN(from.getTime())) return null
    return nextOccurrence(parsed.data, from)
  }, [draft, anchorIso])

  if (!editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={disabled}
          onClick={() => setDraft(DEFAULT_RECURRENCE)}
        >
          <Repeat className="size-4" aria-hidden="true" />
          {t('work.recurrence.enable')}
        </Button>
        <p className="text-caption text-muted-foreground">{t('work.recurrence.disabledHint')}</p>
      </div>
    )
  }

  const rule = draft
  const weekdays = rule.weekdays ?? []

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3">
      <RadioGroup
        value={rule.mode}
        onValueChange={(mode) => update({ mode: mode as RecurrenceMode })}
        aria-label={t('work.recurrence.modeLabel')}
        className="flex flex-col gap-2"
      >
        <RadioOption
          value="schedule"
          label={t('work.recurrence.mode.schedule')}
          description={t('work.recurrence.mode.scheduleHint')}
        />
        <RadioOption
          value="after_done"
          label={t('work.recurrence.mode.afterDone')}
          description={t('work.recurrence.mode.afterDoneHint')}
        />
      </RadioGroup>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('work.recurrence.everyLabel')} htmlFor={`${fieldId}-interval`}>
          <Input
            id={`${fieldId}-interval`}
            type="number"
            min={1}
            max={60}
            inputMode="numeric"
            value={rule.interval}
            disabled={disabled}
            className="w-24"
            onChange={(e) => {
              const next = Number(e.target.value)
              update({ interval: Number.isFinite(next) ? Math.min(60, Math.max(1, next)) : 1 })
            }}
          />
        </Field>
        <Field label={t('work.recurrence.freqLabel')} htmlFor={`${fieldId}-freq`}>
          <Select
            id={`${fieldId}-freq`}
            value={rule.freq}
            disabled={disabled}
            onChange={(e) => update({ freq: e.target.value as RecurrenceFreq })}
            options={FREQ_OPTIONS.map((freq) => ({
              value: freq,
              label: t(FREQ_LABEL_KEY[freq], { count: rule.interval }),
            }))}
          />
        </Field>
      </div>

      {rule.freq === 'weekly' ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-small font-medium text-foreground">
            {t('work.recurrence.weekdaysLabel')}
          </legend>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => {
              const on = weekdays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() =>
                    update({
                      weekdays: on ? weekdays.filter((d) => d !== day) : [...weekdays, day].sort(),
                    })
                  }
                  className={cn(
                    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border px-2 text-caption font-medium',
                    'transition-colors duration-(--dur-micro) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(WEEKDAY_LABEL_KEY[day]!)}
                </button>
              )
            })}
          </div>
          {weekdays.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t('work.recurrence.weekdaysEmptyHint')}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {rule.freq === 'monthly' ? (
        <Field
          label={t('work.recurrence.dayOfMonthLabel')}
          htmlFor={`${fieldId}-dom`}
          hint={t('work.recurrence.dayOfMonthHint')}
        >
          <Input
            id={`${fieldId}-dom`}
            type="number"
            min={1}
            max={31}
            inputMode="numeric"
            value={rule.dayOfMonth ?? ''}
            disabled={disabled}
            className="w-24"
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                const { dayOfMonth: _dropped, ...rest } = rule
                setDraft(rest)
                return
              }
              const next = Number(raw)
              update({
                dayOfMonth: Number.isFinite(next) ? Math.min(31, Math.max(1, next)) : 1,
              })
            }}
          />
        </Field>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t('work.recurrence.untilLabel')}
          htmlFor={`${fieldId}-until`}
          hint={t('work.recurrence.untilHint')}
        >
          <Input
            id={`${fieldId}-until`}
            type="date"
            value={rule.until ?? ''}
            disabled={disabled}
            onChange={(e) => update({ until: e.target.value === '' ? null : e.target.value })}
          />
        </Field>
        <Field
          label={t('work.recurrence.countLabel')}
          htmlFor={`${fieldId}-count`}
          hint={t('work.recurrence.countHint')}
        >
          <Input
            id={`${fieldId}-count`}
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            className="w-28"
            value={rule.count ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value
              update({ count: raw === '' ? null : Math.min(500, Math.max(1, Number(raw) || 1)) })
            }}
          />
        </Field>
      </div>

      <p aria-live="polite" className="text-caption text-muted-foreground">
        {preview
          ? t('work.recurrence.nextPreview', { date: formatDate(preview, locale) })
          : t('work.recurrence.noNext')}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={disabled}>
          {t('common.save')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setDraft(null)
            onCommit(null)
          }}
        >
          {t('work.recurrence.stop')}
        </Button>
      </div>
      <p className="text-caption text-muted-foreground">{t('work.recurrence.stopHint')}</p>
    </div>
  )
}
