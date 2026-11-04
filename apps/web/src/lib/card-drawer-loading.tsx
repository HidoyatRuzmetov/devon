import { Dialog, DialogContent } from '@devon/ui'
import { useT } from '@devon/i18n'
import { replaceSearchParam, useSearchParams } from './router.js'
import { ViewSkeleton } from './view-skeleton.js'
import '../features/work/components/card-detail-drawer.css'

/** Keep the routed drawer visible while its code chunk is loading. */
export function CardDrawerLoading() {
  const t = useT()
  const search = useSearchParams()
  return (
    <Dialog
      open={Boolean(search.get('card'))}
      onOpenChange={(open) => !open && replaceSearchParam('card', null)}
    >
      <DialogContent
        title={t('work.card.peekTitle')}
        titleHidden
        aria-describedby={undefined}
        className="card-detail-drawer inset-y-0 right-0 top-0 left-auto h-dvh max-h-none w-full max-w-(--width-detail-panel) translate-x-0 translate-y-0 overflow-auto rounded-none border-l p-6 md:rounded-l-lg"
      >
        <ViewSkeleton view="card" />
      </DialogContent>
    </Dialog>
  )
}
