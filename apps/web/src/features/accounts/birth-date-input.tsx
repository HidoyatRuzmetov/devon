import { useRef, type InputHTMLAttributes } from 'react'
import { useT } from '@devon/i18n'
import { Input } from '@devon/ui'
import { CalendarDays } from 'lucide-react'
import { z } from 'zod'
import './birth-date-input.css'

const isoDate = z.iso.date()

function fromDateText(text: string): string {
  // A phone's numeric keyboard need not have a period: 31071992 works too.
  const parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(text)
  if (!parts) return text
  const iso = `${parts[3]}-${parts[2]}-${parts[1]}`
  return isoDate.safeParse(iso).success ? iso : text
}

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max'
> & {
  value: string
  onValueChange: (value: string) => void
  min?: string
  max?: string
  paper?: boolean
}

/** Date-only values never pass through a timezone. Keep unfinished edits visible until corrected. */
export function BirthDateInput({
  value,
  onValueChange,
  min,
  max,
  paper,
  disabled,
  ...props
}: Props) {
  const t = useT()
  const textInput = useRef<HTMLInputElement>(null)
  const iso = isoDate.safeParse(value).success ? value : ''
  const shown = iso ? `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : value
  const valid = !value || (!!iso && (!min || iso >= min) && (!max || iso <= max))
  const Text = paper ? 'input' : Input
  return (
    <span className="birth-date-control">
      <Text
        ref={textInput}
        placeholder="dd.mm.yyyy"
        {...props}
        type="text"
        inputMode="numeric"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={10}
        disabled={disabled}
        value={shown}
        title="dd.mm.yyyy"
        pattern={valid ? undefined : '(?!)'}
        onChange={(event) => {
          event.currentTarget.setCustomValidity('')
          onValueChange(fromDateText(event.currentTarget.value))
        }}
      />
      <span className="birth-date-calendar">
        <CalendarDays aria-hidden="true" size={16} />
        <input
          type="date"
          aria-label={t('portal.overview.calendar')}
          disabled={disabled}
          min={min}
          max={max}
          value={iso}
          onChange={(event) => {
            textInput.current?.setCustomValidity('')
            onValueChange(event.currentTarget.value)
          }}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker?.()
            } catch {
              // The native indicator still handles clicks in cross-origin frames.
            }
          }}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && event.currentTarget.showPicker) {
              try {
                event.currentTarget.showPicker()
                event.preventDefault()
              } catch {
                // Keep native activation in embedded contexts where showPicker is restricted.
              }
            }
          }}
        />
      </span>
    </span>
  )
}
