// Pomodoro settings + session log/stats (TECH-SPEC §3.3). The live timer itself is
// `pomodoro-widget.tsx` (mounted at the top of `personal-screen.tsx`) -- this panel is the
// "settings, editable" + "session log and simple stats" half of the requirement.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Flame, ListChecks, Timer } from 'lucide-react'
import { Button, Input, Separator, StateView, toast } from '@devon/ui'
import {
  usePatchPomodoroSettingsMutation,
  usePomodoroSessionsQuery,
  usePomodoroSettingsQuery,
  usePomodoroStatsQuery,
} from './use-personal.js'
import type { PomodoroSettings } from './types.js'

const SOUNDS: PomodoroSettings['sound'][] = ['chime', 'bell', 'digital', 'none']

function formatClock(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function PomodoroPanel() {
  const t = useT()
  const settingsQuery = usePomodoroSettingsQuery()
  const sessionsQuery = usePomodoroSessionsQuery()
  const statsQuery = usePomodoroStatsQuery()
  const patchSettings = usePatchPomodoroSettingsMutation()

  const [draft, setDraft] = React.useState<PomodoroSettings | null>(null)
  React.useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data)
  }, [settingsQuery.data, draft])

  if (settingsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (settingsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => settingsQuery.refetch() }}
      />
    )
  }
  const settings = draft ?? settingsQuery.data
  const stats = statsQuery.data

  function save(patch: Partial<PomodoroSettings>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setDraft(next)
    patchSettings.mutate(patch, { onError: () => toast(t('toast.saveError')) })
  }

  return (
    <div className="flex flex-col gap-8">
      {stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            icon={Flame}
            label={t('personal.pomodoro.stats.todayFocus')}
            value={`${stats.today.focusMinutes} ${t('personal.pomodoro.stats.minutesShort')}`}
          />
          <StatTile
            icon={Timer}
            label={t('personal.pomodoro.stats.todaySessions')}
            value={String(stats.today.focusSessions)}
          />
          <StatTile
            icon={Flame}
            label={t('personal.pomodoro.stats.weekFocus')}
            value={`${stats.week.focusMinutes} ${t('personal.pomodoro.stats.minutesShort')}`}
          />
          <StatTile
            icon={ListChecks}
            label={t('personal.pomodoro.stats.weekSessions')}
            value={String(stats.week.focusSessions)}
          />
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <h3 className="text-h3 text-foreground">{t('personal.pomodoro.settings.title')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label={t('personal.pomodoro.settings.focusMin')}
            value={settings?.focusMin ?? 25}
            min={1}
            max={180}
            onCommit={(v) => save({ focusMin: v })}
          />
          <NumberField
            label={t('personal.pomodoro.settings.shortBreakMin')}
            value={settings?.shortBreakMin ?? 5}
            min={1}
            max={60}
            onCommit={(v) => save({ shortBreakMin: v })}
          />
          <NumberField
            label={t('personal.pomodoro.settings.longBreakMin')}
            value={settings?.longBreakMin ?? 15}
            min={1}
            max={120}
            onCommit={(v) => save({ longBreakMin: v })}
          />
          <NumberField
            label={t('personal.pomodoro.settings.cyclesBeforeLong')}
            value={settings?.cyclesBeforeLong ?? 4}
            min={1}
            max={20}
            onCommit={(v) => save({ cyclesBeforeLong: v })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-small font-medium text-foreground">
            {t('personal.pomodoro.settings.sound')}
          </span>
          <div className="flex flex-wrap gap-2">
            {SOUNDS.map((sound) => (
              <Button
                key={sound}
                type="button"
                size="sm"
                variant={settings?.sound === sound ? 'primary' : 'secondary'}
                onClick={() => save({ sound })}
              >
                {t(`personal.pomodoro.sound.${sound}`)}
              </Button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-body text-foreground">
          <input
            type="checkbox"
            checked={settings?.notifications ?? true}
            onChange={(e) => save({ notifications: e.target.checked })}
            className="size-4 rounded-sm border-border"
          />
          {t('personal.pomodoro.settings.notifications')}
        </label>
        <label className="flex items-center gap-2 text-body text-foreground">
          <input
            type="checkbox"
            checked={settings?.autoStart ?? false}
            onChange={(e) => save({ autoStart: e.target.checked })}
            className="size-4 rounded-sm border-border"
          />
          {t('personal.pomodoro.settings.autoStart')}
        </label>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h3 className="text-h3 text-foreground">{t('personal.pomodoro.log.title')}</h3>
        {sessionsQuery.isPending ? (
          <StateView kind="loading" titleKey="state.loading" />
        ) : sessionsQuery.data && sessionsQuery.data.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {sessionsQuery.data.slice(0, 30).map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-small"
              >
                <span className="text-foreground">
                  {t(
                    `personal.pomodoro.phase.${session.kind === 'focus' ? 'focus' : session.kind === 'short_break' ? 'shortBreak' : 'longBreak'}`,
                  )}
                </span>
                <span className="text-muted-foreground">
                  {formatClock(session.startedAt)}
                  {session.endedAt ? ` – ${formatClock(session.endedAt)}` : ''}
                </span>
                <span className={session.completed ? 'text-success' : 'text-muted-foreground'}>
                  {t(
                    session.completed
                      ? 'personal.pomodoro.log.completed'
                      : 'personal.pomodoro.log.skipped',
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <StateView
            kind="empty"
            titleKey="personal.pomodoro.log.empty.title"
            bodyKey="personal.pomodoro.log.empty.body"
          />
        )}
      </section>
    </div>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-h3 text-foreground">{value}</span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}) {
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  return (
    <label className="flex flex-col gap-1">
      <span className="text-small font-medium text-foreground">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = Math.min(max, Math.max(min, Number(text) || value))
          setText(String(parsed))
          if (parsed !== value) onCommit(parsed)
        }}
      />
    </label>
  )
}
