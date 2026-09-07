// The card peek panel (TECH-SPEC §5: "card peek panel and full card page"): opened from any work-
// module view via the `?card=<id>` search param (so peeking a card never loses the board/table/
// filter you were looking at underneath), closed by Escape/overlay-click/the dialog's own close
// button -- all three just clear the param. `@devon/ui`'s `Sheet` only supports `side="left"|"bottom"`
// (built for the mobile nav drawer and the search overlay), so this docks a `Dialog` to the right
// edge instead of using the centered default, rather than reaching into that package to add a third
// side variant.
import * as React from 'react'
import { Dialog, DialogContent } from '@devon/ui'
import { useT } from '@devon/i18n'
import { replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { CardDetailContent } from './card-detail.js'

export function CardPeekDialog() {
  const t = useT()
  const search = useSearchParams()
  const cardId = search.get('card')

  function close() {
    replaceSearchParam('card', null)
  }

  return (
    <Dialog open={cardId !== null} onOpenChange={(open) => !open && close()}>
      {cardId ? (
        <DialogContent
          title={t('work.card.peekTitle')}
          titleHidden
          // DESIGN.md §9.4: a routed right-hand Sheet at `--width-detail-panel`, full height, over
          // the board -- `DialogOverlay` is already `fixed inset-0` in a Radix Portal (viewport-
          // relative, not sized to any ancestor), so once the board itself stops overflowing the
          // document (its own internal scroller, not the page, per the board-viewport fix) the scrim
          // covers the whole board rather than only the first screenful of a page taller than 100vh.
          className="inset-y-0 right-0 top-0 left-auto h-full w-full max-w-(--width-detail-panel)
            translate-x-0 translate-y-0 overflow-y-auto rounded-none rounded-l-lg border-l"
        >
          <CardDetailContent cardId={cardId} onClose={close} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

export function openCardPeek(cardId: string): void {
  replaceSearchParam('card', cardId)
}
