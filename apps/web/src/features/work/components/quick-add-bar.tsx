// The quick-add bar (TECH-SPEC §5/§4): `"Nodira: EGDI paketi, juma"` -> one Enter keypress creates a
// card assigned to Nodira, due next Friday. Parsing lives in `lib/quick-add.ts` (pure, unit-tested);
// this component is only the input, the resolved-assignee/date preview chips, and the mutation call.
import * as React from 'react'
import { CalendarClock, Plus, UserRound } from 'lucide-react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import { Input, toast } from '@devon/ui'
import { useCreateCardMutation } from '../hooks.js'
import { parseQuickAdd, resolveQuickAddAssignee } from '../lib/quick-add.js'
import type { MemberSummary } from '../api.js'
import { fullName } from '../lib/format.js'

export function QuickAddBar({ members }: { members: readonly MemberSummary[] }) {
  const t = useT()
  const locale = useLocale()
  const [value, setValue] = React.useState('')
  const createCard = useCreateCardMutation()

  const parsed = value.trim().length > 0 ? parseQuickAdd(value) : null
  const resolvedAssignee =
    parsed?.assigneeToken != null ? resolveQuickAddAssignee(parsed.assigneeToken, members) : null

  async function submit() {
    if (!parsed || parsed.title.trim().length === 0) return
    try {
      await createCard.mutateAsync({
        title: parsed.title,
        assigneeUserId: resolvedAssignee?.userId ?? null,
        dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : null,
      })
      setValue('')
      toast(t('work.quickAdd.created', { title: parsed.title }))
    } catch {
      toast(t('work.quickAdd.error'))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={t('work.quickAdd.placeholder')}
          aria-label={t('work.quickAdd.placeholder')}
          disabled={createCard.isPending}
        />
      </div>
      {parsed && (parsed.assigneeToken || parsed.dueAt) ? (
        <div className="flex flex-wrap items-center gap-3 pl-6 text-caption text-muted-foreground">
          {parsed.assigneeToken ? (
            <span className="flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden="true" />
              {resolvedAssignee
                ? fullName(resolvedAssignee)
                : t('work.quickAdd.unknownAssignee', { name: parsed.assigneeToken })}
            </span>
          ) : null}
          {parsed.dueAt ? (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              {formatDate(parsed.dueAt, locale)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
