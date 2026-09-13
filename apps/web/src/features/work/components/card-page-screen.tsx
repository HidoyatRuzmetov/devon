// The full card page (TECH-SPEC §5: "card peek panel and full card page") -- `/work/card?id=<id>`,
// a permanent, bookmarkable/shareable URL for one card, rendering the exact same
// `CardDetailContent` the peek dialog uses, just as the page itself rather than a docked overlay.
import { useT } from '@devon/i18n'
import { StateView } from '@devon/ui'
import { RouterLink, useSearchParams } from '../../../lib/router.js'
import { useCardSignalSource, useRealtimeChannels } from '../../../lib/realtime/index.js'
import { useMeQuery } from '../../../lib/session.js'
import { CardDetailContent } from './card-detail.js'

export default function CardPageScreen() {
  const t = useT()
  const search = useSearchParams()
  const id = search.get('id')

  // v1.1 EPIC-018. Every other work view renders inside `WorkShell`, which mounts the board signal
  // source once; this page deliberately does not (it is one card, not a view of the board), so it
  // mounts its own. Without this, two people on the same card page would each be typing into a
  // comment box with no idea the other one was -- exactly the case the indicator exists for.
  //
  // The two mount points never overlap: `WorkShell` wraps board/table/timeline/calendar/mine/archive
  // (and therefore the peek dialog), this page wraps nothing else.
  const viewerId = useMeQuery().data?.user.id ?? null
  const channels = useRealtimeChannels()
  useCardSignalSource(channels?.board ?? null, viewerId)

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
