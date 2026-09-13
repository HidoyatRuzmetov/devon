// v1.1 SPEC §7 (A3) -- the estimate field: natural-language entry in four locales.
//
// The field accepts what a civil servant actually types -- "2", "2 soat 30 daqiqa", "1,5 soat",
// "3 kun", "2ч 30мин", "90m" -- and echoes back what it understood *before* the blur that saves it,
// so nobody discovers a week later that "3 kun" was stored as three minutes. `parseEstimateMinutes`
// is the shared rule from `@devon/contracts`: the server validates with the same function, so the
// field can never accept something the API then refuses.
import * as React from 'react'
import { Timer } from 'lucide-react'
import { MAX_ESTIMATE_MINUTES, parseEstimateMinutes } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Input, cn } from '@devon/ui'
import { formatDuration } from '../lib/estimate.js'

export interface EstimateFieldProps {
  /** Current stored value in minutes, or `null` when nobody has estimated this card. */
  value: number | null
  /** Called with the parsed minutes (or `null` to clear) once the user commits -- blur or Enter.
   * Never called for an unparseable string: the field stays in its "I did not understand" state
   * rather than silently storing a different number than the one on screen. */
  onCommit: (minutes: number | null) => void
  disabled?: boolean
  id?: string
  className?: string
}

export function EstimateField({
  value,
  onCommit,
  disabled = false,
  id,
  className,
}: EstimateFieldProps): React.JSX.Element {
  const t = useT()
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`

  // The draft is what the user typed; `value` is what is stored. They diverge only while editing.
  const [draft, setDraft] = React.useState(() => (value ? formatDuration(value, t) : ''))
  const [focused, setFocused] = React.useState(false)

  // Re-sync when the card changes underneath (another tab, an automation, a bulk edit) -- but never
  // while this field has focus, which would yank the text out from under the person typing.
  React.useEffect(() => {
    if (!focused) setDraft(value ? formatDuration(value, t) : '')
  }, [value, focused]) // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = draft.trim()
  const parsed = trimmed === '' ? null : parseEstimateMinutes(trimmed)
  const unreadable = trimmed !== '' && parsed === null
  const clamped = parsed !== null && parsed >= MAX_ESTIMATE_MINUTES

  function commit(): void {
    setFocused(false)
    if (trimmed === '') {
      if (value !== null) onCommit(null)
      setDraft('')
      return
    }
    if (parsed === null) {
      // Unreadable: put the stored value back rather than leaving a number on screen that is not
      // the one in the database.
      setDraft(value ? formatDuration(value, t) : '')
      return
    }
    if (parsed !== value) onCommit(parsed)
    setDraft(formatDuration(parsed, t))
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="relative">
        <Timer
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={inputId}
          value={draft}
          disabled={disabled}
          invalid={unreadable}
          aria-describedby={hintId}
          placeholder={t('work.estimate.placeholder')}
          className="pl-9"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(value ? formatDuration(value, t) : '')
              e.currentTarget.blur()
            }
          }}
        />
      </div>
      {/* One live region for all three messages, so a screen reader hears the echo of what was
          understood exactly as a sighted user sees it. */}
      <p
        id={hintId}
        aria-live="polite"
        className={cn('text-caption', unreadable ? 'text-destructive' : 'text-muted-foreground')}
      >
        {unreadable
          ? t('work.estimate.unreadable')
          : clamped
            ? t('work.estimate.clamped')
            : focused && parsed !== null
              ? t('work.estimate.understood', { value: formatDuration(parsed, t) })
              : t('work.estimate.hint')}
      </p>
    </div>
  )
}
