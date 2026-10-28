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
import './card-detail-drawer.css'

export function CardPeekDialog() {
  const t = useT()
  const search = useSearchParams()
  const cardId = search.get('card')
  const [retainedCardId, setRetainedCardId] = React.useState(cardId)
  const panel = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (cardId) setRetainedCardId(cardId)
  }, [cardId])
  const displayedCardId = cardId ?? retainedCardId

  function close() {
    replaceSearchParam('card', null)
  }

  return (
    <Dialog open={cardId !== null} onOpenChange={(open) => !open && close()}>
      {displayedCardId ? (
        <DialogContent
          ref={panel}
          title={t('work.card.peekTitle')}
          titleHidden
          showClose={false}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            panel.current?.focus()
          }}
          // DESIGN.md §9.4: a routed right-hand Sheet at `--width-detail-panel`, full height, over
          // the board -- `DialogOverlay` is already `fixed inset-0` in a Radix Portal (viewport-
          // relative, not sized to any ancestor), so once the board itself stops overflowing the
          // document (its own internal scroller, not the page, per the board-viewport fix) the scrim
          // covers the whole board rather than only the first screenful of a page taller than 100vh.
          className="card-detail-drawer inset-y-0 right-0 top-0 left-auto h-dvh max-h-none w-full max-w-(--width-detail-panel)
            translate-x-0 translate-y-0 overflow-hidden rounded-none border-l p-0 md:rounded-l-lg"
        >
          <CardDetailContent
            key={displayedCardId}
            cardId={displayedCardId}
            onClose={close}
            presentation="drawer"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

export { openCardPeek } from '../lib/open-card-peek.js'
