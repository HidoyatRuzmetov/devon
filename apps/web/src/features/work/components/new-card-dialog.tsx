// SPEC §12 / WALKTHROUGH-FINDINGS §2.2 -- "the global + Yangi → Yangi vazifa does nothing".
//
// It used to navigate to `/work` and stop: no dialog, no focused input, `document.activeElement`
// still the button that was pressed. The most prominent control in the product had a dead primary
// item, and the person was dumped on the board to go and find the quick-add field themselves.
//
// This is that composer. `?new=1` on `/work` opens it -- the same query-string convention `/events?
// new=1` already uses, because `src/lib/router.tsx` is exact-path-only -- and it hosts the very
// `QuickAddBar` the board's columns use, so the typed grammar ("Nodira: hisobot, juma"), the AI
// parse and the four-locale date words all behave identically wherever a card is created. Closing
// clears the parameter, so Back does what it looks like it does and the URL is shareable.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Dialog, DialogContent } from '@devon/ui'
import { replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { useBoardQuery } from '../hooks.js'
import { QuickAddBar } from './quick-add-bar.js'

export function NewCardDialog() {
  const t = useT()
  const search = useSearchParams()
  const open = search.get('new') === '1'
  // Only fetched while the dialog is actually open -- the board screen already holds this query, so
  // on `/work` this is a cache hit and costs no request at all.
  const boardQuery = useBoardQuery()
  const members = boardQuery.data?.members ?? []

  function close(): void {
    replaceSearchParam('new', null)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {open ? (
        <DialogContent title={t('work.actions.create')} className="max-w-2xl">
          <div className="flex flex-col gap-3 pt-2">
            <p className="text-small text-muted-foreground">{t('work.quickAdd.dialogHint')}</p>
            <QuickAddBar
              members={members}
              onCreated={() => {
                // One card, then out of the way: a composer that stayed open after creating would
                // make "did that work?" the next question. The board behind it has already
                // invalidated and re-rendered with the new card in place.
                close()
              }}
            />
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

/** Opens the composer from anywhere -- the shell's "+ Yangi" menu routes here. */
export const NEW_CARD_PATH = '/work?new=1'
