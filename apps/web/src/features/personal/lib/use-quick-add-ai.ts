// The "clean up my quick-add text" AI wiring (TECH-SPEC §8 `quick_add_parse`), shared between
// `today-view.tsx`'s single quick-add row and `tasks-view.tsx`'s one-per-section rows.
//
// A personal to-do has no assignee (I-1: the personal workspace is owner-only, and there is nobody
// else in it), so `members` is genuinely empty here and the feature's assignee field is genuinely
// unused -- that part of v1.0 was honest. What was *not* honest was calling the feature with no
// `today` (AI-AUDIT §0.3): the prompt orders it to resolve "ertaga" and "jumagacha" against today's
// date, and there was no date, so every relative date was invented or dropped. It is supplied now,
// in Asia/Tashkent, and the parsed due date is kept alongside the title.
import * as React from 'react'
import type { useT, Locale } from '@devon/i18n'
import { useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { parseFeatureOutput, type QuickAddOutput } from '../../ai/outputs.js'
import type { RunMeta } from '../../ai/types.js'
import { aiErrorMessageKey } from './ai-helpers.js'

export type QuickAddAiState =
  | { status: 'pending' }
  | { status: 'ready'; output: QuickAddOutput; meta: RunMeta }
  | { status: 'error'; message: string }

/** Today in Asia/Tashkent -- the department's own clock, so a person travelling does not silently
 * get yesterday's Friday. */
export function todayInTashkent(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function useQuickAddAi(t: ReturnType<typeof useT>, locale: Locale) {
  const runMutation = useRunAiFeatureMutation('quick_add_parse')
  const [state, setState] = React.useState<QuickAddAiState | null>(null)

  const run = React.useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setState({ status: 'pending' })
      runMutation.mutate(
        {
          scope: 'personal',
          locale,
          text: trimmed,
          today: todayInTashkent(),
          members: [],
          labels: [],
          projects: [],
          defaultAssigneeUserId: null,
        },
        {
          onSuccess: (res) => {
            const output = parseFeatureOutput<QuickAddOutput>('quick_add_parse', res.data)
            if (!output) {
              setState({ status: 'error', message: t('ai.errors.runFailed') })
              return
            }
            setState({ status: 'ready', output, meta: res.meta })
          },
          onError: (err) => setState({ status: 'error', message: t(aiErrorMessageKey(err)) }),
        },
      )
    },
    [runMutation, locale, t],
  )

  const discard = React.useCallback(() => setState(null), [])

  return { state, run, discard }
}
