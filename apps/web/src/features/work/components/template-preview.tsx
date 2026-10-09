// v1.1 SPEC §7.2 -- what a template *contains*, shown before it is used.
//
// The payload arrives as an opaque `Record<string, unknown>` (the server stores it as JSONB and does
// not care what shape it is beyond the two schemas in `@devon/contracts`). Parsing it here with
// those same schemas means the preview can never claim a template has a checklist it does not, and
// a payload written by a future version simply previews as "nothing to show" rather than throwing
// inside a gallery card.
import * as React from 'react'
import { CalendarDays, ListChecks, Timer } from 'lucide-react'
import {
  cardTemplatePayloadSchema,
  projectTemplatePayloadSchema,
  type CardTemplatePayload,
  type ProjectTemplatePayload,
} from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Chip } from '@devon/ui'
import { formatDurationShort } from '../lib/estimate.js'
import { PRIORITY_LABEL_KEY } from '../lib/format.js'
import type { WorkTemplate } from '../api-plus.js'

export function readCardPayload(payload: Record<string, unknown>): CardTemplatePayload | null {
  const parsed = cardTemplatePayloadSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

export function readProjectPayload(
  payload: Record<string, unknown>,
): ProjectTemplatePayload | null {
  const parsed = projectTemplatePayloadSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

export function TemplatePreview({
  template,
}: {
  template: WorkTemplate
}): React.JSX.Element | null {
  const t = useT()

  if (template.kind === 'card') {
    const payload = readCardPayload(template.payload)
    if (!payload) return null
    return (
      <div className="flex flex-col gap-2">
        <p className="text-small text-foreground [overflow-wrap:anywhere]">{payload.title}</p>
        <div className="flex flex-wrap gap-1.5">
          {payload.priority && payload.priority !== 'none' ? (
            <Chip tone="outline">{t(PRIORITY_LABEL_KEY[payload.priority])}</Chip>
          ) : null}
          {payload.estimateMin ? (
            <Chip tone="outline" leading={<Timer className="size-3" />}>
              {formatDurationShort(payload.estimateMin, t)}
            </Chip>
          ) : null}
          {payload.dueInDays != null ? (
            <Chip tone="outline" leading={<CalendarDays className="size-3" />}>
              {t('work.templates.dueInDays', { count: payload.dueInDays })}
            </Chip>
          ) : null}
          {payload.checklist && payload.checklist.length > 0 ? (
            <Chip tone="outline" leading={<ListChecks className="size-3" />}>
              {t('work.templates.checklistCount', { count: payload.checklist.length })}
            </Chip>
          ) : null}
        </div>
      </div>
    )
  }

  const payload = readProjectPayload(template.payload)
  if (!payload) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-foreground [overflow-wrap:anywhere]">{payload.title}</p>
      <div className="flex flex-wrap gap-1.5">
        {payload.milestones && payload.milestones.length > 0 ? (
          <Chip tone="outline" leading={<CalendarDays className="size-3" />}>
            {t('work.templates.milestoneCount', { count: payload.milestones.length })}
          </Chip>
        ) : null}
        {payload.cards && payload.cards.length > 0 ? (
          <Chip tone="outline" leading={<ListChecks className="size-3" />}>
            {t('work.templates.cardCount', { count: payload.cards.length })}
          </Chip>
        ) : null}
      </div>
    </div>
  )
}
