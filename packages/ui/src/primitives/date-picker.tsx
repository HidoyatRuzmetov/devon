import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { FIELD_TRANSITION } from '../lib/focus-ring.js'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'

/** DESIGN.md §3: "DatePicker (uz/ru/en, holidays greyed, week starts Monday)".
 *
 * Month and weekday names come from `Intl.DateTimeFormat` in the *active* locale rather than from a
 * bundled `date-fns` locale pack: Devon ships four locales, two of them Uzbek, and pulling four
 * locale packs into the main chunk to render twelve month names is the wrong trade against the
 * bundle budget in `agentic/gates.json`. `Intl` already has this data in every browser Devon
 * supports, in every one of the four locales.
 *
 * Week starts Monday everywhere (`weekStartsOn={1}`) -- not a per-locale decision here: the working
 * week in an Uzbek ministry is Monday–Friday and a calendar that starts on Sunday for the `en`
 * locale would show a different grid to two colleagues looking at the same screen. */

const NAV_BUTTON_CLASS =
  'inline-flex size-9 items-center justify-center rounded-sm text-foreground ' +
  'transition-colors duration-(--dur-micro) ease-out hover:bg-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

export interface CalendarProps {
  /** BCP-47 tag of the active locale, e.g. `uz-Latn`, `ru`. */
  locale: string
  selected?: Date | undefined
  onSelect: (date: Date | undefined) => void
  /** Days that cannot be chosen (past dates, public holidays -- DESIGN.md's "holidays greyed"). */
  disabled?: Date[] | ((date: Date) => boolean)
  /** Rendered under the grid, e.g. a holiday legend. */
  footer?: React.ReactNode
  className?: string
  /** Accessible name for the grid. */
  label: string
}

function useIntlFormatters(locale: string) {
  return React.useMemo(() => {
    const caption = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric' })
    return {
      formatCaption: (month: Date) => caption.format(month),
      formatWeekdayName: (date: Date) => weekday.format(date),
      formatDay: (date: Date) => day.format(date),
    }
  }, [locale])
}

/** The bare grid, for a screen that wants a calendar inline (the events month view, a range filter). */
export function Calendar({
  locale,
  selected,
  onSelect,
  disabled,
  footer,
  className,
  label,
}: CalendarProps): React.JSX.Element {
  const formatters = useIntlFormatters(locale)
  return (
    <DayPicker
      mode="single"
      aria-label={label}
      weekStartsOn={1}
      showOutsideDays
      {...(selected ? { selected } : {})}
      {...(disabled ? { disabled } : {})}
      onSelect={onSelect}
      formatters={formatters}
      {...(footer ? { footer } : {})}
      className={cn('text-body text-foreground', className)}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          ),
      }}
      classNames={{
        root: 'p-1',
        months: 'flex flex-col gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-9 items-center px-1',
        caption_label: 'text-body font-medium capitalize text-foreground',
        nav: 'absolute right-1 top-1 flex items-center gap-1',
        button_previous: NAV_BUTTON_CLASS,
        button_next: NAV_BUTTON_CLASS,
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'w-9 text-caption font-normal uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground',
        week: 'flex w-full',
        day: 'p-0',
        day_button: cn(
          'inline-flex size-9 items-center justify-center rounded-sm text-body tabular-nums',
          'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        ),
        selected: '[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:font-medium',
        today: '[&_button]:border [&_button]:border-attention',
        outside: 'text-muted-foreground opacity-50',
        disabled: 'text-muted-foreground opacity-40 [&_button]:pointer-events-none',
        footer: 'pt-2 text-caption text-muted-foreground',
      }}
      style={{ position: 'relative' }}
    />
  )
}

export interface DatePickerProps extends CalendarProps {
  /** Shown on the trigger when nothing is chosen. */
  placeholder: string
  /** How the chosen date reads on the trigger. Defaults to `DD.MM.YYYY` (DESIGN.md §5). */
  formatValue?: (date: Date) => string
  invalid?: boolean
  triggerClassName?: string
  disabledTrigger?: boolean
}

function defaultFormat(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

/** The trigger + popover form every form field uses. */
export function DatePicker({
  placeholder,
  formatValue = defaultFormat,
  invalid = false,
  triggerClassName,
  disabledTrigger = false,
  ...calendar
}: DatePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={calendar.label}
          // Not `aria-invalid`: ARIA does not define it on `role="button"`, which this element
          // implicitly has. The invalid state is carried by the border token plus the field-level
          // error message the caller associates with `aria-describedby`.
          data-invalid={invalid || undefined}
          disabled={disabledTrigger}
          className={cn(
            'inline-flex h-11 w-full items-center justify-between gap-2 rounded-sm border border-border',
            'bg-card px-3 text-body text-foreground',
            FIELD_TRANSITION,
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            invalid && 'border-destructive focus-visible:ring-destructive',
            triggerClassName,
          )}
        >
          <span className={cn('tabular-nums', !calendar.selected && 'text-muted-foreground')}>
            {calendar.selected ? formatValue(calendar.selected) : placeholder}
          </span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          {...calendar}
          onSelect={(date) => {
            calendar.onSelect(date)
            if (date) setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
