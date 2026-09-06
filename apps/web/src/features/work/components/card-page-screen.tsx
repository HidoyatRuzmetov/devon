// The full card page (TECH-SPEC §5: "card peek panel and full card page") -- `/work/card?id=<id>`,
// a permanent, bookmarkable/shareable URL for one card, rendering the exact same
// `CardDetailContent` the peek dialog uses, just as the page itself rather than a docked overlay.
import { useT } from '@devon/i18n'
import { StateView } from '@devon/ui'
import { RouterLink, useSearchParams } from '../../../lib/router.js'
import { CardDetailContent } from './card-detail.js'

export default function CardPageScreen() {
  const t = useT()
  const search = useSearchParams()
  const id = search.get('id')

  if (!id) {
    return (
      <StateView
        kind="empty"
        titleKey="work.card.noIdTitle"
        bodyKey="work.card.noIdBody"
        action={{ labelKey: 'work.view.board', onAction: () => (window.location.href = '/work') }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-200 pb-12">
      <RouterLink
        href="/work"
        className="mb-4 inline-block text-small text-primary underline underline-offset-2"
      >
        {t('work.card.backToBoard')}
      </RouterLink>
      <CardDetailContent cardId={id} />
    </div>
  )
}
