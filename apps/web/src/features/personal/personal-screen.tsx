// The personal workspace screen (TECH-SPEC §3.3): today/focus, sprints, tasks, notes, canvas,
// Pomodoro -- one route (`/personal`), tabbed internally (MODULE-GUIDE.md: routes are exact-path
// only, no nested params yet). The Pomodoro widget renders at the top of every tab so it is visible
// while working, not tucked away inside the Pomodoro tab alone -- see `pomodoro-widget.tsx`'s header
// for the follow-up that would make it visible from every route in the app, not only this one.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { CalendarClock, ListTodo, NotebookPen, PenTool, Sun, Timer } from 'lucide-react'
import { StateView, cn } from '@devon/ui'
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 text-foreground">{t('personal.title')}</h1>
        <PomodoroWidget activeTaskId={focusedTaskId} />
      </div>

      <div
        role="tablist"
        aria-label={t('personal.title')}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-t-sm px-3 py-2 text-small font-medium',
              tab === id
                ? 'border-b-2 border-primary text-foreground'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'today' ? (
          <TodayView focusedTaskId={focusedTaskId} onFocusTask={setFocusedTaskId} />
        ) : null}
        {tab === 'sprints' ? <SprintsView /> : null}
        {tab === 'tasks' ? <TasksView /> : null}
        {tab === 'notes' ? <NotesView /> : null}
        {tab === 'canvas' ? <CanvasView /> : null}
        {tab === 'pomodoro' ? <PomodoroPanel /> : null}
      </div>
    </div>
  )
}
