// `/inbox/preferences` (this module's task: "preferences per type and channel ... quiet hours").
// Every toggle in the matrix saves itself the moment it changes (no separate Save button for a grid
// of checkboxes -- CLAUDE.md "undo over confirm" generalises to "no confirm step for a reversible
// flip"); quiet hours is the one sub-form with a real Save, because a half-typed time range is not
// yet a valid preference to persist.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Input, StateView, toast } from '@devon/ui'
import { Check } from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { useMeQuery } from '../../lib/session.js'
import { useDepartment } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { isQuietHoursTooLoud, CHANNELS, DIGEST_MODES, REASONS, type PrefRow } from './api.js'
import {
  usePrefsQuery,
  usePutPrefsMutation,
  usePutQuietHoursMutation,
  useQuietHoursQuery,
} from './hooks.js'
import { minutesToTimeInput, timeInputToMinutes, formatMinuteRange } from './time.js'
import { ReasonIcon } from './reason-icon.js'
import { fetchIcsUrl } from './api.js'

function PrefsMatrix({ items }: { items: PrefRow[] }) {
  const t = useT()
  const putPrefs = usePutPrefsMutation()
  const byKey = React.useMemo(
    () => new Map(items.map((r) => [`${r.reason}:${r.channel}`, r])),
    [items],
  )

  function toggle(row: PrefRow) {
    putPrefs.mutate([{ ...row, enabled: !row.enabled }])
  }

  function setDigestMode(row: PrefRow, digestMode: PrefRow['digestMode']) {
    putPrefs.mutate([{ ...row, digestMode }])
  }

  const digestRowTelegram = byKey.get('digest:telegram')
  const digestRowEmail = byKey.get('digest:email')

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="border-b border-border text-small text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">
                {t('inbox.preferences.reasonColumn')}
              </th>
              {CHANNELS.map((channel) => (
                <th key={channel} className="px-4 py-3 text-center font-medium">
                  {t(`inbox.channel.${channel}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REASONS.map((reason) => (
              <tr key={reason} className="border-b border-border last:border-b-0">
                <td className="flex items-center gap-2 px-4 py-3">
                  <ReasonIcon reason={reason} className="size-4 text-muted-foreground" />
                  <span>{t(`inbox.reason.${reason}`)}</span>
                </td>
                {CHANNELS.map((channel) => {
                  const row = byKey.get(`${reason}:${channel}`)
                  if (!row) {
                    return <td key={channel} />
                  }
                  return (
                    <td key={channel} className="px-4 py-3 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.enabled}
                        aria-label={t('inbox.preferences.toggleAria', {
                          reason: t(`inbox.reason.${reason}`),
                          channel: t(`inbox.channel.${channel}`),
                        })}
                        onClick={() => toggle(row)}
                        className={`mx-auto flex size-6 items-center justify-center rounded-sm border transition-colors duration-(--dur-micro) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          row.enabled
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card'
                        }`}
                      >
                        {row.enabled ? <Check className="size-4" aria-hidden="true" /> : null}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {digestRowTelegram || digestRowEmail ? (
        <div className="rounded-md border border-border bg-card p-4">
          <h3 className="mb-3 text-h4 text-foreground">{t('inbox.preferences.digestFrequency')}</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
            {digestRowTelegram ? (
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-small text-muted-foreground">
                  {t('inbox.channel.telegram')}
                </span>
                <select
                  value={digestRowTelegram.digestMode}
                  onChange={(e) =>
                    setDigestMode(digestRowTelegram, e.target.value as PrefRow['digestMode'])
                  }
                  className="h-10 rounded-sm border border-border bg-card px-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {DIGEST_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`inbox.preferences.digestMode.${mode}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {digestRowEmail ? (
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-small text-muted-foreground">{t('inbox.channel.email')}</span>
                <select
                  value={digestRowEmail.digestMode}
                  onChange={(e) =>
                    setDigestMode(digestRowEmail, e.target.value as PrefRow['digestMode'])
                  }
                  className="h-10 rounded-sm border border-border bg-card px-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {DIGEST_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`inbox.preferences.digestMode.${mode}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function QuietHoursCard({ departmentId }: { departmentId: string | null }) {
  const t = useT()
  const quietHoursQuery = useQuietHoursQuery(departmentId)
  const putQuietHours = usePutQuietHoursMutation(departmentId)
  const [start, setStart] = React.useState('')
  const [end, setEnd] = React.useState('')
  const [weekends, setWeekends] = React.useState(true)
  const [touched, setTouched] = React.useState(false)
  const [tooLoud, setTooLoud] = React.useState(false)

  const data = quietHoursQuery.data
  React.useEffect(() => {
    if (!data || touched) return
    setStart(minutesToTimeInput(data.startMinute))
    setEnd(minutesToTimeInput(data.endMinute))
    setWeekends(data.includeWeekends ?? data.effective.includeWeekends)
  }, [data, touched])

  if (quietHoursQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (quietHoursQuery.isError || !data) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => quietHoursQuery.refetch() }}
      />
    )
  }

  const usingOverride = data.startMinute !== null

  async function handleSave() {
    setTooLoud(false)
    try {
      await putQuietHours.mutateAsync({
        startMinute: timeInputToMinutes(start),
        endMinute: timeInputToMinutes(end),
        includeWeekends: weekends,
      })
      toast(t('inbox.preferences.saved'))
      setTouched(false)
    } catch (err) {
      if (isQuietHoursTooLoud(err)) setTooLoud(true)
      else toast(t('toast.saveError'))
    }
  }

  async function handleUseDefault() {
    setTooLoud(false)
    await putQuietHours.mutateAsync({ startMinute: null, endMinute: null, includeWeekends: null })
    setTouched(false)
    toast(t('inbox.preferences.saved'))
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h3 className="text-h4 text-foreground">{t('inbox.preferences.quietHours.title')}</h3>
      <p className="mt-1 text-small text-muted-foreground">
        {t(
          data.effective.source === 'department_default'
            ? 'inbox.preferences.quietHours.usingDepartmentDefault'
            : 'inbox.preferences.quietHours.usingPersonal',
          { range: formatMinuteRange(data.effective.startMinute, data.effective.endMinute) },
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-small text-muted-foreground">
            {t('inbox.preferences.quietHours.start')}
          </span>
          <Input
            type="time"
            value={start}
            onChange={(e) => {
              setTouched(true)
              setStart(e.target.value)
            }}
            className="w-32"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-small text-muted-foreground">
            {t('inbox.preferences.quietHours.end')}
          </span>
          <Input
            type="time"
            value={end}
            onChange={(e) => {
              setTouched(true)
              setEnd(e.target.value)
            }}
            className="w-32"
          />
        </label>
        <label className="flex items-center gap-2 pb-2.5">
          <input
            type="checkbox"
            checked={weekends}
            onChange={(e) => {
              setTouched(true)
              setWeekends(e.target.checked)
            }}
            className="size-4 rounded-sm border-border"
          />
          <span className="text-body text-foreground">
            {t('inbox.preferences.quietHours.weekends')}
          </span>
        </label>
      </div>
      {tooLoud ? (
        <p role="alert" className="mt-3 text-small text-destructive">
          {t('inbox.preferences.quietHours.tooLoud')}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={handleSave} loading={putQuietHours.isPending}>
          {t('inbox.preferences.save')}
        </Button>
        {usingOverride ? (
          <Button size="sm" variant="ghost" onClick={handleUseDefault}>
            {t('inbox.preferences.quietHours.useDefault')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CalendarFeedCard() {
  const t = useT()
  const [url, setUrl] = React.useState<string | null>(null)

  async function handleReveal() {
    const result = await fetchIcsUrl()
    setUrl(new URL(result.url, window.location.origin).toString())
  }

  async function handleCopy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast(t('toast.copied'))
    } catch {
      toast(t('toast.saveError'))
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h3 className="text-h4 text-foreground">{t('inbox.preferences.calendar.title')}</h3>
      <p className="mt-1 text-small text-muted-foreground">
        {t('inbox.preferences.calendar.body')}
      </p>
      {url ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded-sm bg-muted px-2 py-1 text-caption">
            {url}
          </code>
          <Button size="sm" variant="secondary" onClick={handleCopy}>
            {t('inbox.preferences.calendar.copy')}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="mt-3" onClick={handleReveal}>
          {t('inbox.preferences.calendar.reveal')}
        </Button>
      )}
    </div>
  )
}

function PrefsMatrixBody({ query }: { query: ReturnType<typeof usePrefsQuery> }) {
  if (query.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
      />
    )
  }
  return <PrefsMatrix items={query.data.items} />
}

export default function PreferencesScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const { departmentId } = useDepartment()
  const prefsQuery = usePrefsQuery()

  const settled = !meQuery.isPending

  React.useEffect(() => {
    if (forced) return
    if (settled && meQuery.data === null) navigate('/login')
  }, [forced, settled, meQuery.data])

  if (forced) {
    return <ForcedStateBlock kind={forced} />
  }
  if (!settled) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (meQuery.data === null) return null

  if (!online && prefsQuery.data === undefined) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => prefsQuery.refetch() }}
      />
    )
  }

  return (
    <div className="mx-auto flex max-w-200 flex-col gap-6">
      <div>
        <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('inbox.eyebrow')}
        </p>
        <h1 className="font-display text-h1 text-foreground">{t('inbox.preferences.title')}</h1>
        <p className="mt-1 text-body text-muted-foreground">{t('inbox.preferences.body')}</p>
      </div>

      <PrefsMatrixBody query={prefsQuery} />

      <QuietHoursCard departmentId={departmentId} />
      <CalendarFeedCard />
    </div>
  )
}
