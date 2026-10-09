// The personal workspace screen (TECH-SPEC §3.3): today/focus, sprints (called "periods" in copy),
// tasks, notes, canvas, Pomodoro -- one route (`/personal`), tabbed internally (MODULE-GUIDE.md:
// routes are exact-path only, no nested params yet), following the page-header + sliding-underline
// tabs recipe every other screen in the product uses (DESIGN.md §9.1).
//
// The Pomodoro widget renders in the header's actions slot on every tab, not tucked away inside the
// Pomodoro tab alone -- see `pomodoro-widget.tsx`'s header for the follow-up that would make it
// visible from every route in the app, not only this one.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { CalendarClock, ListTodo, NotebookPen, PenTool, Sun, Timer } from 'lucide-react'
import { PageHeader, StateView, Tabs, TabsContent, TabsList, TabsTrigger } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import { PomodoroWidget } from './pomodoro-widget.js'
import { PomodoroPanel } from './pomodoro-panel.js'
import { TodayView } from './today-view.js'
import { SprintsView } from './sprints-view.js'
import { TasksView } from './tasks-view.js'
import { NotesView } from './notes-view.js'
import { CanvasView } from './canvas-view.js'

type TabId = 'today' | 'sprints' | 'tasks' | 'notes' | 'canvas' | 'pomodoro'

const TABS: {
  id: TabId
  labelKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}[] = [
  { id: 'today', labelKey: 'personal.tabs.today', icon: Sun },
  { id: 'sprints', labelKey: 'personal.tabs.sprints', icon: CalendarClock },
  { id: 'tasks', labelKey: 'personal.tabs.tasks', icon: ListTodo },
  { id: 'notes', labelKey: 'personal.tabs.notes', icon: NotebookPen },
  { id: 'canvas', labelKey: 'personal.tabs.canvas', icon: PenTool },
  { id: 'pomodoro', labelKey: 'personal.tabs.pomodoro', icon: Timer },
]

const REQUESTED_TAB_KEY = 'devon.personal.requestedTab'

export default function PersonalScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const [tab, setTab] = React.useState<TabId>(() => {
    try {
      const requested = window.sessionStorage.getItem(REQUESTED_TAB_KEY)
      window.sessionStorage.removeItem(REQUESTED_TAB_KEY)
      if (requested && TABS.some((tb) => tb.id === requested)) return requested as TabId
    } catch {
      // Storage disabled -- default tab.
    }
    return 'today'
  })
  const [focusedTaskId, setFocusedTaskId] = React.useState<string | null>(null)

  if (meQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (!meQuery.data) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('personal.eyebrow')}
        title={t('personal.title')}
        description={t('personal.description')}
        actions={<PomodoroWidget activeTaskId={focusedTaskId} />}
        tabs={
          <TabsList aria-label={t('personal.title')}>
            {TABS.map(({ id, labelKey, icon: Icon }) => (
              <TabsTrigger key={id} value={id}>
                <Icon className="size-4" aria-hidden="true" />
                {t(labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      <TabsContent value="today">
        <TodayView focusedTaskId={focusedTaskId} onFocusTask={setFocusedTaskId} />
      </TabsContent>
      <TabsContent value="sprints">
        <SprintsView />
      </TabsContent>
      <TabsContent value="tasks">
        <TasksView />
      </TabsContent>
      <TabsContent value="notes">
        <NotesView />
      </TabsContent>
      <TabsContent value="canvas">
        <CanvasView />
      </TabsContent>
      <TabsContent value="pomodoro">
        <PomodoroPanel activeTaskId={focusedTaskId} />
      </TabsContent>
    </Tabs>
  )
}
