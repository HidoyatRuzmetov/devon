import * as React from 'react'
import { useT } from '@devon/i18n'
import { SegmentedControl, cn } from '@devon/ui'
import { useSearchParams } from '../../lib/router.js'
import { InboxPanel } from '../inbox/inbox-screen.js'

export const HOME_METRIC_INTERACTION =
  'relative cursor-pointer transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-2 motion-reduce:transform-none motion-reduce:transition-none'

/** Home keeps two readable columns on desktop. On a phone the same panels have a deliberate
 * switch and their own scroll region, rather than squeezing both columns into a narrow strip. */
export function HomeWorkspace({
  children,
  panel,
  onPanelChange,
}: {
  children: React.ReactNode
  panel: 'inbox' | 'work'
  onPanelChange: (value: 'inbox' | 'work') => void
}) {
  const t = useT()
  const search = useSearchParams()
  const inbox = search.get('inbox')
  React.useEffect(() => {
    if (inbox) onPanelChange('inbox')
  }, [inbox, onPanelChange])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SegmentedControl
        className="shrink-0 self-start lg:hidden"
        value={panel}
        onValueChange={onPanelChange}
        label={t('homeMember.panels')}
        options={[
          { value: 'inbox', label: t('inbox.title') },
          { value: 'work', label: t('homeRefinement.workOverview') },
        ]}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className={cn('min-h-0', panel !== 'inbox' && 'hidden lg:block')}>
          <InboxPanel />
        </div>
        <div
          className={cn(
            'grid min-h-0 grid-rows-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3',
            panel !== 'work' && 'hidden lg:grid',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
