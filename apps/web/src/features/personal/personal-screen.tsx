import { useT } from '@devon/i18n'
import { PageHeader, StateView, Tabs, TabsContent, TabsList, TabsTrigger } from '@devon/ui'
import { CalendarDays, ListTodo, Timer } from 'lucide-react'
import * as React from 'react'
import { replaceSearchParam, useSearchParams } from '../../lib/router.js'
import { useMeQuery } from '../../lib/session.js'
import { PersonalCalendarView } from './calendar-view.js'
import { PomodoroPanel } from './pomodoro-panel.js'
import { TasksView } from './tasks-view.js'

type TabId = 'calendar' | 'tasks' | 'pomodoro'

const TABS: {
  id: TabId
  labelKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}[] = [
  { id: 'calendar', labelKey: 'personalCalendar.tab', icon: CalendarDays },
  { id: 'tasks', labelKey: 'personal.tabs.tasks', icon: ListTodo },
  { id: 'pomodoro', labelKey: 'personal.tabs.pomodoro', icon: Timer },
]

export default function PersonalScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const search = useSearchParams()
  const requested = search.get('tab')
  const tab: TabId = requested === 'tasks' || requested === 'pomodoro' ? requested : 'calendar'

  if (meQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (!meQuery.data) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => replaceSearchParam('tab', v)}
      className="flex flex-col gap-6"
    >
      <PageHeader
        eyebrow={t('personal.eyebrow')}
        title={t('personal.title')}
        tabs={
          <TabsList
            aria-label={t('personal.title')}
            className="max-sm:grid max-sm:grid-cols-3 max-sm:gap-0"
          >
            {TABS.map(({ id, labelKey, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="max-sm:flex-col max-sm:gap-1 max-sm:px-1 max-sm:text-caption max-sm:whitespace-normal max-sm:text-center"
              >
                <Icon className="size-4" aria-hidden="true" />
                {t(labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      <TabsContent value="calendar">
        <PersonalCalendarView />
      </TabsContent>
      <TabsContent value="tasks">
        <TasksView />
      </TabsContent>
      <TabsContent value="pomodoro">
        <PomodoroPanel />
      </TabsContent>
    </Tabs>
  )
}
