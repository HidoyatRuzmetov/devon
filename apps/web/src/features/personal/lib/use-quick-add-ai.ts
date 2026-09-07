// The "clean up my quick-add text" AI wiring (TECH-SPEC §8 `quick_add_parse`), shared between
// `today-view.tsx`'s single quick-add row and `tasks-view.tsx`'s one-per-section rows. Personal
// to-dos have no assignee/due-date/priority fields (those are work-board concepts), so only the
// cleaned-up `title` is ever used -- the rest of the feature's structured output is simply not
// applicable here, which is honest rather than inventing fields this module does not have.
import * as React from 'react'
import type { useT } from '@devon/i18n'
import { useRunAiFeatureMutation } from '../../ai/use-ai.js'
import { aiCostLine, aiErrorMessageKey } from './ai-helpers.js'

export type QuickAddAiState =
  | { status: 'pending' }
  | { status: 'ready'; title: string; costLine: string }
  | { status: 'error'; message: string }

export function useQuickAddAi(t: ReturnType<typeof useT>, locale: string) {
  const runMutation = useRunAiFeatureMutation('quick_add_parse')
  const [state, setState] = React.useState<QuickAddAiState | null>(null)

  const run = React.useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setState({ status: 'pending' })
      runMutation.mutate(
        { locale, text: trimmed, memberNames: [] },
        {
          onSuccess: (res) => {
            const title = String(res.data['title'] ?? trimmed).trim() || trimmed
            setState({ status: 'ready', title, costLine: aiCostLine(t, res.meta) })
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
