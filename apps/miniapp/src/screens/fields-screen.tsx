// "Maʼlumotlarim" -- the person custom fields this xodim can fill in about themselves (SPEC §5).
//
// This is where the head's "notify to fill" lands: the Telegram message carries a `Toʻldirish`
// button whose deep link opens `#/fields`, the row the head asked about is marked, and filling it
// resolves the request and tells the head's progress counter.
//
// The `fields` module ships in its own package. Until it merges, the server answers
// `{ available: false }` (it feature-detects the catalogue) and this screen shows a designed empty
// state rather than an error -- so the Mini App is complete either way and lights up on merge.
import * as React from 'react'
import { useLocale, useT } from '@devon/i18n'
import { Badge, Button, Checkbox, Input, Textarea, cn, toast } from '@devon/ui'
import type { MiniappField, MiniappFieldValue } from '@devon/contracts'
import { getMyFields, setMyField } from '../lib/api.js'
import { useQuery } from '../lib/use-query.js'
import { tg } from '../lib/telegram.js'
import {
  ListSkeleton,
  QueryState,
  ScreenBody,
  ScreenHeader,
  ScreenList,
} from '../components/screen.js'
import { rowSurface } from '../components/bits.js'

function label(text: Record<string, string>, locale: string): string {
  return text[locale] ?? text['uz-Latn'] ?? Object.values(text)[0] ?? ''
}

function asText(value: MiniappFieldValue): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function FieldRow({
  field,
  onSave,
  saving,
}: {
  field: MiniappField
  onSave: (field: MiniappField, value: MiniappFieldValue) => void
  saving: boolean
}): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const [draft, setDraft] = React.useState<string>(asText(field.value))
  React.useEffect(() => setDraft(asText(field.value)), [field.value])

  const dirty = draft !== asText(field.value)
  const readOnly = !field.selfEditable
  const name = label(field.label, locale)

  const commit = (): void => {
    if (field.type === 'number') {
      const parsed = draft.trim() === '' ? null : Number(draft)
      if (parsed !== null && Number.isNaN(parsed)) {
        toast.error(t('miniapp.fields.numberInvalid'))
        return
      }
      onSave(field, parsed)
      return
    }
    if (field.type === 'multi_select') {
      onSave(
        field,
        draft
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      )
      return
    }
    onSave(field, draft.trim() === '' ? null : draft.trim())
  }

  return (
    <div className={cn(rowSurface, 'flex flex-col gap-2')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex-1 text-[14px] leading-5 font-medium">{name}</span>
        {field.requested ? <Badge tone="attention">{t('miniapp.fields.requested')}</Badge> : null}
        {field.required && field.value === null ? (
          <Badge tone="destructive">{t('miniapp.fields.missing')}</Badge>
        ) : null}
      </div>
      {field.description ? (
        <p className="text-muted-foreground text-[12px] leading-4">
          {label(field.description, locale)}
        </p>
      ) : null}

      {field.type === 'checkbox' ? (
        <label className="flex items-center gap-2 text-[13px] leading-5">
          <Checkbox
            checked={field.value === true}
            disabled={readOnly || saving}
            onCheckedChange={(next) => onSave(field, next === true)}
          />
          {t('miniapp.fields.yes')}
        </label>
      ) : field.type === 'select' && field.options.length > 0 ? (
        <div role="group" aria-label={name} className="flex flex-wrap gap-1.5">
          {field.options.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={field.value === option.id ? 'primary' : 'secondary'}
              aria-pressed={field.value === option.id}
              disabled={readOnly || saving}
              onClick={() => onSave(field, option.id)}
            >
              {label(option.label, locale)}
            </Button>
          ))}
        </div>
      ) : field.type === 'long_text' ? (
        <>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={name}
            rows={3}
            disabled={readOnly || saving}
          />
          {dirty ? (
            <Button size="sm" loading={saving} onClick={commit}>
              {t('miniapp.fields.save')}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={name}
            inputMode={field.type === 'number' ? 'numeric' : 'text'}
            type={field.type === 'date' ? 'date' : 'text'}
            disabled={readOnly || saving}
          />
          {dirty ? (
            <Button size="sm" loading={saving} onClick={commit}>
              {t('miniapp.fields.save')}
            </Button>
          ) : null}
        </>
      )}

      {readOnly ? (
        <p className="text-muted-foreground text-[12px] leading-4">
          {t('miniapp.fields.readOnly')}
        </p>
      ) : null}
    </div>
  )
}

export function FieldsScreen(): React.ReactElement {
  const t = useT()
  const query = useQuery(() => getMyFields(), [])
  const [saving, setSaving] = React.useState<string | null>(null)

  const onSave = React.useCallback(
    (field: MiniappField, value: MiniappFieldValue) => {
      setSaving(field.defId)
      setMyField(field.defId, value)
        .then((next) => {
          query.set(next)
          tg.haptic.success()
          toast.success(t('miniapp.fields.saved'))
        })
        .catch(() => toast.error(t('miniapp.fields.saveFailed')))
        .finally(() => setSaving(null))
    },
    [query, t],
  )

  const items = query.data?.items ?? []
  const unavailable = query.data?.available === false

  return (
    <>
      <ScreenHeader
        title={t('miniapp.fields.title')}
        eyebrow={t('miniapp.fields.eyebrow')}
        onBack="history"
      />
      <ScreenBody>
        {query.status === 'loading' && query.data === null ? (
          <ListSkeleton rows={3} />
        ) : query.status === 'error' && query.data === null ? (
          <QueryState error={query.error} onRetry={query.refetch} />
        ) : unavailable || items.length === 0 ? (
          <QueryState
            error={null}
            emptyTitleKey="miniapp.fields.empty.title"
            emptyBodyKey="miniapp.fields.empty.body"
            onRetry={query.refetch}
          />
        ) : (
          <ScreenList>
            {items.map((field) => (
              <FieldRow
                key={field.defId}
                field={field}
                onSave={onSave}
                saving={saving === field.defId}
              />
            ))}
          </ScreenList>
        )}
      </ScreenBody>
    </>
  )
}
