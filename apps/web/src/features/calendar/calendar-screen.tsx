// `/calendar` (v1.1 SPEC §10, EPIC-019): the agenda, the secret subscription feeds, and the web-push
// opt-in -- three things that are all "my calendar leaves WorkPortal and reaches me elsewhere".
//
// Tabs rather than three routes, and the tab lives in the query string (`?tab=feeds`) so a person can
// link a colleague straight to the subscription instructions -- matching `router.tsx`'s "exact paths,
// state in the query string" tradeoff that `features/events` already follows for `?event=`.
//
// The whole screen is personal: `can()` on every route behind it takes the `personal` subject, which
// has no head exception (I-1). A boshqarma boshligʻi has exactly the same screen as a xodim here and
// sees only their own feeds -- there is deliberately no "team calendar" surface, because a head
// enumerating when everyone's phone syncs is surveillance, not management.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { PageHeader, PageTransition, Tabs, TabsContent, TabsList, TabsTrigger } from '@devon/ui'
import { navigate, useSearchParams } from '../../lib/router.js'
import { AgendaPanel } from './components/agenda-panel.js'
import { FeedsPanel } from './components/feeds-panel.js'
import { PushPanel } from './components/push-panel.js'

const TABS = ['agenda', 'feeds', 'push'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value)
}

export default function CalendarScreen(): React.JSX.Element {
  const t = useT()
  const params = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = isTab(raw) ? raw : 'agenda'

  return (
    <PageTransition routeKey="/calendar">
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={t('calendar.eyebrow')}
          title={t('calendar.title')}
          description={t('calendar.description')}
        />

        <Tabs
          value={tab}
          onValueChange={(next) =>
            navigate(next === 'agenda' ? '/calendar' : `/calendar?tab=${next}`)
          }
        >
          <TabsList>
            {TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {t(`calendar.tabs.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="agenda">
            <AgendaPanel />
          </TabsContent>
          <TabsContent value="feeds">
            <FeedsPanel />
          </TabsContent>
          <TabsContent value="push">
            <PushPanel />
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  )
}
