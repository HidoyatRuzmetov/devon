// One wording for "the AI could not answer", across every host screen that runs a feature.
//
// This lived in `features/personal/lib/ai-helpers.ts` while the personal workspace was the only
// place AI ran; v1.1 put a SparkleButton on the card sheet, the project page, the analytics Ask box
// and the head dashboard's briefing tile, and a second copy of the mapping in each of them is four
// chances to tell a civil servant something different about the same 403.
import { ApiError } from '../../../lib/api-client.js'

/**
 * Maps a failed `useRunAiFeatureMutation` call to one of the `ai.errors.*` keys.
 *
 * `forbidden` is deliberately split: the gateway answers it both for "your head switched this helper
 * off" (`errors: [{ path: 'feature', code: 'disabled' }]`) and for "this helper is head-only"
 * (`code: 'head_only'`), and those are different sentences -- the first is fixable from `/ai` by the
 * person reading it, the second never is. Telling a head "this helper is switched off or the budget
 * ran out" when the real answer is "switch it on, here" is exactly the vagueness the CTO called out
 * about the AI surfaces.
 */
export function aiErrorMessageKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'validation_failed') return 'ai.errors.invalidInput'
    if (err.code === 'forbidden') {
      const reason = err.errors.find((e) => e.path === 'feature')?.code
      if (reason === 'disabled') return 'ai.errors.featureDisabled'
      if (reason === 'head_only') return 'ai.errors.headOnly'
      return 'ai.errors.forbidden'
    }
    if (err.code === 'internal') return 'ai.errors.runFailed'
  }
  return 'toast.saveError'
}
