// One control per field type, and the chip row that renders an answer read-only.
//
// Built here rather than in `packages/ui` on purpose (this package's brief): it is a *shared
// primitive of this feature* -- the member fill form, the head's manager and the card detail
// property column all render exactly these, so a `select` looks and behaves the same wherever a
// person meets it. If a second feature ever needs it, this is the file the merge promotes.
//
// Validation is `@devon/contracts`'s `validateFieldValue`, the same function the server calls, so a
// value this control refuses is exactly a value the API would have refused -- and the message the
// person reads comes from `fields.error.<code>` in the four locale files, never from the server.
import * as React from 'react'
import { Check } from 'lucide-react'
import { useLocale, useT } from '@devon/i18n'
import { isOptionType, validateFieldValue, type FieldDef } from '@devon/contracts'
import { Checkbox, DatePicker, HoverLift, Input, Select, Textarea, cn } from '@devon/ui'
import type { FieldDefDto, WireFieldValue } from '../api.js'
import { fieldLabel, optionLabel, optionTone, selectedOptions } from '../format.js'

/** The DTO is structurally the contract type plus two extra keys; the validator only reads the
 * shared ones, so this is a widening cast, not a lie. */
function asContractDef(def: FieldDefDto): FieldDef {
  return def as unknown as FieldDef
}

export type FieldValueInputProps = {
  def: FieldDefDto
  value: WireFieldValue
  onChange: (value: WireFieldValue) => void
  /** Rendered read-only, with the same shape, when the viewer may look but not edit. */
  disabled?: boolean
  /** Marks the control invalid and wires `aria-describedby` to the message below it. */
  errorCode?: string | null
  id: string
  /** A card property's visible term names its inline editor; profile fields use native labels. */
  labelledBy?: string
}

export function FieldValueInput({
  def,
  value,
  onChange,
  disabled = false,
  errorCode = null,
  id,
  labelledBy,
}: FieldValueInputProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const describedBy = errorCode ? `${id}-error` : undefined
  const invalid = errorCode !== null

  const common = {
    id,
    'aria-labelledby': labelledBy,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    disabled,
  } as const

  switch (def.type) {
    case 'checkbox':
      return (
        <div className="flex min-h-11 items-center">
          <Checkbox
            id={id}
            checked={value === true}
            disabled={disabled}
            aria-label={fieldLabel(def, locale)}
            aria-describedby={describedBy}
            onCheckedChange={(next) => onChange(next === true)}
          />
        </div>
      )

    case 'number':
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          value={value === null || value === undefined ? '' : String(value)}
          placeholder={t('fields.input.numberPlaceholder')}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )

    case 'date':
      return (
        <DatePicker
          locale={String(locale)}
          label={fieldLabel(def, locale)}
          placeholder={t('fields.input.datePlaceholder')}
          invalid={invalid}
          disabledTrigger={disabled}
          triggerClassName="w-full"
          selected={
            typeof value === 'string' && value
              ? // A calendar day has no UTC offset. Both the picker and the wire day use local dates.
                new Date(`${value}T00:00:00`)
              : undefined
          }
          onSelect={(date) =>
            onChange(
              date
                ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                : null,
            )
          }
        />
      )

    case 'long_text':
      return (
        <Textarea
          {...common}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          placeholder={t('fields.input.textPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'url':
      return (
        <Input
          {...common}
          type="url"
          inputMode="url"
          value={typeof value === 'string' ? value : ''}
          placeholder={t('fields.input.urlPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'select':
      return (
        <Select
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          options={[
            { value: '', label: t('fields.input.selectPlaceholder') },
            ...def.options.map((o) => ({ value: o.id, label: optionLabel(o, locale) })),
          ]}
        />
      )

    case 'multi_select': {
      const chosen = new Set(Array.isArray(value) ? value : [])
      return (
        <div
          role="group"
          aria-label={fieldLabel(def, locale)}
          aria-describedby={describedBy}
          className="flex flex-wrap gap-2"
        >
          {def.options.map((option) => {
            const active = chosen.has(option.id)
            return (
              <HoverLift key={option.id} className="rounded-full">
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => {
                    const next = new Set(chosen)
                    if (active) next.delete(option.id)
                    else next.add(option.id)
                    onChange([...next])
                  }}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-small',
                    'transition-colors duration-(--dur-micro) ease-out',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    active
                      ? optionTone(option.colorToken)
                      : 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {active ? <Check aria-hidden="true" className="size-3.5" /> : null}
                  {optionLabel(option, locale)}
                </button>
              </HoverLift>
            )
          })}
        </div>
      )
    }

    case 'derived':
      return <p className="text-small text-muted-foreground">{t('fields.input.derivedHint')}</p>

    case 'person':
    case 'text':
    default:
      return (
        <Input
          {...common}
          value={typeof value === 'string' ? value : ''}
          placeholder={t('fields.input.textPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/* The two early returns below are braced rather than written on one line on purpose: a `/>` sitting
 * directly above a bare `return (` reads to the i18n gate's hard-coded-JSX-text heuristic as a text
 * node between two tags. Same reason as the `LocaleMap` alias in `field-form-dialog.tsx`. */

/** The read-only rendering of an answer: option chips keep their colour, everything else is text,
 * and "nothing yet" is always the same em dash rather than an empty cell. */
export type FieldValueDisplayProps = {
  def: FieldDefDto
  value: WireFieldValue
  className?: string | undefined
}

export function FieldValueDisplay({
  def,
  value,
  className,
}: FieldValueDisplayProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()

  if (isOptionType(def.type)) {
    const options = selectedOptions(def, value)
    if (options.length === 0) {
      return <EmptyValue className={className} />
    }
    return (
      <span className={cn('flex flex-wrap gap-1.5', className)}>
        {options.map((option) => (
          <span
            key={option.id}
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-caption',
              optionTone(option.colorToken),
            )}
          >
            {optionLabel(option, locale)}
          </span>
        ))}
      </span>
    )
  }

  if (def.type === 'checkbox') {
    if (value === null || value === undefined) {
      return <EmptyValue className={className} />
    }
    return (
      <span className={cn('text-body text-foreground', className)}>
        {value === true ? t('fields.value.yes') : t('fields.value.no')}
      </span>
    )
  }

  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return <EmptyValue className={className} />
  }

  if (def.type === 'url' && typeof value === 'string') {
    return (
      <a
        href={value}
        rel="noreferrer noopener"
        target="_blank"
        className={cn('text-body text-accent-foreground underline underline-offset-2', className)}
      >
        {value}
      </a>
    )
  }

  if (def.type === 'number') {
    return (
      <span className={cn('text-body tabular-nums text-foreground', className)}>
        {new Intl.NumberFormat(String(locale)).format(Number(value))}
      </span>
    )
  }

  return (
    <span className={cn('text-body whitespace-pre-line text-foreground', className)}>
      {String(value)}
    </span>
  )
}

function EmptyValue({ className }: { className?: string | undefined }): React.JSX.Element {
  const t = useT()
  return (
    <span
      className={cn('text-body text-muted-foreground', className)}
      title={t('fields.value.empty')}
    >
      —
    </span>
  )
}

/** Client-side check, identical to the server's. Returns the `fields.error.<code>` suffix, or null. */
export function checkValue(def: FieldDefDto, value: WireFieldValue): string | null {
  const result = validateFieldValue(asContractDef(def), value)
  return result.ok ? null : result.error
}
