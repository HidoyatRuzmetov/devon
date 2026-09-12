// Create or edit one field definition (v1.1 SPEC §5) -- the head's form.
//
// The refusals live here as well as on the server, and say the same thing in the same words:
//   * I-2. A label that names birth data, a passport, a taxpayer id, a home location, pay, ethnicity
//     or religion is refused *as you type it*, in whichever of the four locales you typed it in,
//     with `fields.error.personalData`. The check is `@devon/contracts`'s `isBlockedFieldLabel`, the
//     one the API calls -- not a second list that could drift.
//   * The caps (20 card fields, 10 person fields), with the reason in the copy.
//   * A key is machine text: lower-case ASCII, because `field:<key>:<value>` is typed into a filter
//     bar. It is suggested from the label and then left alone once a person edits it.
import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useLocale, useT } from '@devon/i18n'
import {
  FIELD_TYPES,
  isBlockedFieldLabel,
  isOptionType,
  isValidFieldKey,
  suggestFieldKey,
  type FieldType,
} from '@devon/contracts'
import {
  Button,
  Dialog,
  DialogContent,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  Textarea,
  cn,
} from '@devon/ui'
import type { DefDraft, FieldDefDto, FieldOptionDto } from '../api.js'
import { OPTION_TONE_NAMES, optionTone } from '../format.js'

const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const
type LocaleKey = (typeof LOCALES)[number]

export type FieldFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  appliesTo: 'card' | 'person'
  /** Editing an existing definition; omit to create a new one. */
  existing?: FieldDefDto | null
  /** How many live definitions this entity already has, and the cap -- for the "you are full" copy. */
  used: number
  cap: number
  saving: boolean
  onSubmit: (draft: DefDraft) => void
}

/** A label/description typed per locale. Named rather than inlined so a declaration line never ends
 * in a generic's closing angle bracket -- which the i18n gate's hard-coded-JSX-text heuristic reads
 * as the start of a text node (the same reason `work/components/filter-clause-chips.tsx` spells its
 * operator map as a switch). */
type LocaleMap = Record<string, string>

type FormState = {
  label: LocaleMap
  description: LocaleMap
  key: string
  type: FieldType
  options: FieldOptionDto[]
  required: boolean
  showInTable: boolean
  showOnCardTile: boolean
  selfEditable: boolean
  visibleTo: 'everyone' | 'head_only'
  reminderDays: number
}

function emptyState(): FormState {
  return {
    label: {},
    description: {},
    key: '',
    type: 'text',
    options: [],
    required: false,
    showInTable: true,
    showOnCardTile: false,
    selfEditable: true,
    visibleTo: 'everyone',
    reminderDays: 3,
  }
}

function fromExisting(def: FieldDefDto): FormState {
  return {
    label: { ...def.label },
    description: { ...(def.description ?? {}) },
    key: def.key,
    type: def.type,
    options: def.options.map((o) => ({ ...o, label: { ...o.label } })),
    required: def.required,
    showInTable: def.showInTable,
    showOnCardTile: def.showOnCardTile,
    selfEditable: def.selfEditable,
    visibleTo: def.visibleTo,
    reminderDays: def.reminderDays,
  }
}

export function FieldFormDialog({
  open,
  onOpenChange,
  appliesTo,
  existing = null,
  used,
  cap,
  saving,
  onSubmit,
}: FieldFormDialogProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [state, setState] = React.useState<FormState>(() =>
    existing ? fromExisting(existing) : emptyState(),
  )
  const [keyTouched, setKeyTouched] = React.useState(Boolean(existing))

  // Re-seed whenever the dialog opens for a different definition -- a dialog that keeps the previous
  // field's answers is how a head accidentally renames the wrong column.
  React.useEffect(() => {
    if (!open) return
    setState(existing ? fromExisting(existing) : emptyState())
    setKeyTouched(Boolean(existing))
  }, [open, existing])

  const primaryLabel = state.label[locale as LocaleKey] ?? state.label['uz-Latn'] ?? ''
  const effectiveKey = keyTouched ? state.key : suggestFieldKey(primaryLabel)

  const blockedLocale = LOCALES.find((l) => {
    const text = state.label[l]
    return Boolean(text && isBlockedFieldLabel(text))
  })
  const blockedKey = effectiveKey.length > 0 && isBlockedFieldLabel(effectiveKey)
  const personalDataRefusal = Boolean(blockedLocale) || blockedKey

  const hasLabel = LOCALES.some((l) => (state.label[l] ?? '').trim().length > 0)
  const keyValid = isValidFieldKey(effectiveKey)
  const keyInvalid = effectiveKey.length !== 0 && !keyValid
  const needsOptions = isOptionType(state.type)
  const optionsValid = !needsOptions || state.options.length > 0
  const full = !existing && used >= cap
  const canSubmit = hasLabel && keyValid && optionsValid && !personalDataRefusal && !full && !saving

  function setLabel(l: LocaleKey, value: string): void {
    setState((s) => ({ ...s, label: { ...s.label, [l]: value } }))
  }

  function setDescription(l: LocaleKey, value: string): void {
    setState((s) => ({ ...s, description: { ...s.description, [l]: value } }))
  }

  function addOption(): void {
    setState((s) => ({
      ...s,
      options: [
        ...s.options,
        {
          id: `opt_${s.options.length + 1}`,
          label: {},
          colorToken: OPTION_TONE_NAMES[s.options.length % OPTION_TONE_NAMES.length] ?? 'slate',
          order: s.options.length,
        },
      ],
    }))
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    if (!canSubmit) return
    const label: Record<string, string> = {}
    for (const l of LOCALES) {
      const text = (state.label[l] ?? '').trim()
      if (text) label[l] = text
    }
    const description: Record<string, string> = {}
    for (const l of LOCALES) {
      const text = (state.description[l] ?? '').trim()
      if (text) description[l] = text
    }
    onSubmit({
      appliesTo,
      key: effectiveKey,
      label,
      description: Object.keys(description).length > 0 ? description : null,
      type: state.type,
      options: needsOptions ? state.options.map((o, index) => ({ ...o, order: index })) : [],
      required: state.required,
      defaultValue: null,
      showInTable: state.showInTable,
      showOnCardTile: appliesTo === 'card' ? state.showOnCardTile : false,
      selfEditable: appliesTo === 'person' ? state.selfEditable : true,
      visibleTo: appliesTo === 'person' ? state.visibleTo : 'everyone',
      reminderDays: state.reminderDays,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={existing ? t('fields.form.editTitle') : t('fields.form.createTitle')}
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto"
      >
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {t('fields.form.nameLegend')}
            </legend>
            {LOCALES.map((l) => (
              <Field key={l} label={t(`fields.locale.${l}`)} htmlFor={`field-label-${l}`}>
                <Input
                  id={`field-label-${l}`}
                  value={state.label[l] ?? ''}
                  placeholder={l === 'uz-Latn' ? t('fields.form.namePlaceholder') : ''}
                  aria-invalid={blockedLocale === l || undefined}
                  onChange={(e) => setLabel(l, e.target.value)}
                />
              </Field>
            ))}
            {personalDataRefusal ? (
              <p role="alert" className="text-small text-destructive">
                {t('fields.error.personal_data')}
              </p>
            ) : null}
          </fieldset>

          <Field
            label={t('fields.form.key')}
            htmlFor="field-key"
            hint={t('fields.form.keyHint', { example: `field:${effectiveKey || 'talim'}:...` })}
          >
            <Input
              id="field-key"
              value={effectiveKey}
              aria-invalid={keyInvalid || undefined}
              disabled={Boolean(existing)}
              onChange={(e) => {
                setKeyTouched(true)
                setState((s) => ({ ...s, key: e.target.value.toLowerCase() }))
              }}
            />
          </Field>
          {keyInvalid ? (
            <p role="alert" className="-mt-3 text-small text-destructive">
              {t('fields.error.invalid_key')}
            </p>
          ) : null}

          <Field label={t('fields.form.type')} htmlFor="field-type">
            <Select
              id="field-type"
              value={state.type}
              disabled={Boolean(existing)}
              onChange={(e) => setState((s) => ({ ...s, type: e.target.value as FieldType }))}
              options={FIELD_TYPES.filter((type) => type !== 'derived').map((type) => ({
                value: type,
                label: t(`fields.type.${type}`),
              }))}
            />
          </Field>

          {needsOptions ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
                {t('fields.form.optionsLegend')}
              </legend>
              {state.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={t('fields.form.optionLabelAria', { n: index + 1 })}
                    value={option.label[locale as LocaleKey] ?? option.label['uz-Latn'] ?? ''}
                    placeholder={t('fields.form.optionPlaceholder')}
                    onChange={(e) =>
                      setState((s) => {
                        const options = [...s.options]
                        const current = options[index]!
                        const text = e.target.value
                        options[index] = {
                          ...current,
                          label: { ...current.label, [locale]: text, 'uz-Latn': text },
                          id: suggestFieldKey(text) || current.id,
                        }
                        return { ...s, options }
                      })
                    }
                  />
                  <Select
                    aria-label={t('fields.form.optionColorAria', { n: index + 1 })}
                    className={cn('w-32 border', optionTone(option.colorToken))}
                    value={option.colorToken}
                    onChange={(e) =>
                      setState((s) => {
                        const options = [...s.options]
                        options[index] = { ...options[index]!, colorToken: e.target.value }
                        return { ...s, options }
                      })
                    }
                    options={OPTION_TONE_NAMES.map((name) => ({
                      value: name,
                      label: t(`fields.color.${name}`),
                    }))}
                  />
                  <IconButton
                    type="button"
                    aria-label={t('fields.form.optionRemove')}
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        options: s.options.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </IconButton>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={addOption}>
                <Plus aria-hidden="true" className="size-4" />
                {t('fields.form.optionAdd')}
              </Button>
              {!optionsValid ? (
                <p role="alert" className="text-small text-destructive">
                  {t('fields.error.needs_options')}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {t('fields.form.behaviourLegend')}
            </legend>

            <SwitchRow
              id="field-required"
              label={t('fields.form.required')}
              hint={t('fields.form.requiredHint')}
              checked={state.required}
              onChange={(v) => setState((s) => ({ ...s, required: v }))}
            />
            <SwitchRow
              id="field-show-in-table"
              label={t('fields.form.showInTable')}
              hint={t('fields.form.showInTableHint')}
              checked={state.showInTable}
              onChange={(v) => setState((s) => ({ ...s, showInTable: v }))}
            />
            {appliesTo === 'card' ? (
              <SwitchRow
                id="field-show-on-tile"
                label={t('fields.form.showOnCardTile')}
                hint={t('fields.form.showOnCardTileHint')}
                checked={state.showOnCardTile}
                onChange={(v) => setState((s) => ({ ...s, showOnCardTile: v }))}
              />
            ) : null}
            {appliesTo === 'person' ? (
              <>
                <SwitchRow
                  id="field-self-editable"
                  label={t('fields.form.selfEditable')}
                  hint={t('fields.form.selfEditableHint')}
                  checked={state.selfEditable}
                  onChange={(v) => setState((s) => ({ ...s, selfEditable: v }))}
                />
                <Field
                  label={t('fields.form.visibility')}
                  htmlFor="field-visibility"
                  hint={t('fields.form.visibilityHint')}
                >
                  <Select
                    id="field-visibility"
                    value={state.visibleTo}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        visibleTo: e.target.value as 'everyone' | 'head_only',
                      }))
                    }
                    options={[
                      { value: 'everyone', label: t('fields.visibility.everyone') },
                      { value: 'head_only', label: t('fields.visibility.headOnly') },
                    ]}
                  />
                </Field>
                <Field
                  label={t('fields.form.reminderDays')}
                  htmlFor="field-reminder-days"
                  hint={t('fields.form.reminderDaysHint')}
                >
                  <Input
                    id="field-reminder-days"
                    type="number"
                    min={1}
                    max={30}
                    value={String(state.reminderDays)}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        reminderDays: Math.min(30, Math.max(1, Number(e.target.value) || 3)),
                      }))
                    }
                  />
                </Field>
              </>
            ) : null}
          </fieldset>

          <Field label={t('fields.form.description')} htmlFor="field-description">
            <Textarea
              id="field-description"
              rows={2}
              value={state.description[locale as LocaleKey] ?? ''}
              placeholder={t('fields.form.descriptionPlaceholder')}
              onChange={(e) => setDescription(locale as LocaleKey, e.target.value)}
            />
          </Field>

          {full ? (
            <p role="alert" className="text-small text-warning">
              {t('fields.error.cap_reached_detail', { cap })}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('fields.form.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {existing ? t('fields.form.save') : t('fields.form.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex min-w-0 flex-col">
        <span className="text-body text-foreground">{label}</span>
        <span className="text-small text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export default FieldFormDialog
