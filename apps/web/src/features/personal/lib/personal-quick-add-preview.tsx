import { formatDate, useLocale, useT, type Locale } from '@devon/i18n'
import type { QuickAddOutput } from '../../ai/outputs.js'
import { FieldRow } from '../../ai/components/ai-result-panel.js'

/** Private tasks have notes, not due-date/priority columns. Preserve these requests honestly. */
export function personalQuickAddNotes(
  output: QuickAddOutput,
  request: string,
  t: ReturnType<typeof useT>,
  locale: Locale,
): string | null {
  const details: string[] = []
  if (output.dueDate)
    details.push(
      `${t('assistantHelpers.requestedDate')}: ${formatDate(new Date(`${output.dueDate}T00:00:00Z`), locale)}`,
    )
  if (output.priority !== 'none')
    details.push(
      `${t('assistantHelpers.requestedPriority')}: ${t(`work.priority.${output.priority}`)}`,
    )
  if (details.length) details.push(`${t('assistantHelpers.originalRequest')}: ${request.trim()}`)
  if (output.notes) details.push(output.notes)
  return details.join('\n') || null
}

export function PersonalQuickAddPreview({
  output,
  request,
}: {
  output: QuickAddOutput
  request: string
}) {
  const t = useT(),
    locale = useLocale()
  const notes = personalQuickAddNotes(output, request, t, locale)
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t('ai.preview.quickAdd.title')}>
        <span className="font-medium">{output.title}</span>
      </FieldRow>
      {notes ? (
        <>
          <FieldRow label={t('assistantHelpers.savedNotes')}>
            <span className="whitespace-pre-wrap">{notes}</span>
          </FieldRow>
          <p className="text-caption text-muted-foreground">
            {t('assistantHelpers.privateTaskHint')}
          </p>
        </>
      ) : null}
    </div>
  )
}
