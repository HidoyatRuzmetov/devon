// `/inbox/preferences` (this module's task: "preferences per type and channel ... quiet hours").
// Every toggle in the matrix saves itself the moment it changes (no separate Save button for a grid
// of checkboxes -- CLAUDE.md "undo over confirm" generalises to "no confirm step for a reversible
// flip"); quiet hours is the one sub-form with a real Save, because a half-typed time range is not
// yet a valid preference to persist.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Chip, Input, PageHeader, SectionCard, StateView, Switch, toast } from '@devon/ui'
import { useForcedState } from '../../lib/forced-state.js'
import { useMeQuery } from '../../lib/session.js'
import { useDepartment } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import {
  isQuietHoursTooLoud,
  AVAILABLE_CHANNELS,
  PERSONAL_DIGEST_MODES,
  REASONS,
  type PrefRow,
} from './api.js'
import {
  usePrefsQuery,
  usePutPrefsMutation,
  usePutQuietHoursMutation,
  useQuietHoursQuery,
} from './hooks.js'
import { minutesToTimeInput, timeInputToMinutes, formatMinuteRange } from './time.js'
import { REASON_TONE, ReasonIcon } from './reason-icon.js'
import { fetchIcsUrl } from './api.js'

/** The type x channel matrix (UI-OVERHAUL.md "preferences as the settings recipe: a matrix of type x
 * channel with Switches"). One `SectionCard` per DESIGN.md §9.5's settings recipe -- every toggle
 * here saves itself the instant it flips (CLAUDE.md "undo over confirm" generalised to "no confirm
 * step for a reversible flip"), so the card carries no save button of its own. */
function PrefsMatrix({ items }: { items: PrefRow[] }) {
  const t = useT()
  const putPrefs = usePutPrefsMutation()
  const byKey = React.useMemo(
    () => new Map(items.map((r) => [`${r.reason}:${r.channel}`, r])),
    [items],
  )

  function toggle(row: PrefRow) {
    const digestMode =
      row.reason === 'digest'
        ? row.digestMode === 'off' || row.digestMode === 'instant'
          ? 'daily'
          : row.digestMode
        : 'instant'
    putPrefs.mutate([{ ...row, enabled: !row.enabled, digestMode }], {
      onError: () => toast(t('toast.saveError')),
    })
  }

  function setDigestMode(row: PrefRow, digestMode: PrefRow['digestMode']) {
    putPrefs.mutate([{ ...row, digestMode, enabled: digestMode !== 'off' }], {
      onError: () => toast(t('toast.saveError')),
    })
  }

  const digestRowTelegram = byKey.get('digest:telegram')

  return (
    <>
      <SectionCard title={t('inbox.preferences.matrixTitle')} className="overflow-hidden">
        <div className="-mx-5 -my-4 overflow-x-auto">
          <table className="w-full min-w-140 border-collapse text-body">
            <thead>
              <tr className="border-b border-border text-small text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">
                  {t('inbox.preferences.reasonColumn')}
                </th>
                {AVAILABLE_CHANNELS.map((channel) => (
                  <th key={channel} className="px-4 py-3 text-center font-medium">
                    {t(`inbox.channel.${channel}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REASONS.map((reason) => (
                <tr key={reason} className="border-b border-border last:border-b-0">
                  <td className="px-5 py-3">
                    <Chip
                      tone={REASON_TONE[reason]}
                      leading={<ReasonIcon reason={reason} className="size-3" />}
                    >
                      {t(`inbox.reason.${reason}`)}
                    </Chip>
                  </td>
                  {AVAILABLE_CHANNELS.map((channel) => {
                    const row = byKey.get(`${reason}:${channel}`)
                    if (!row) {
                      return <td key={channel} />
                    }
                    return (
                      <td key={channel} className="px-4 py-3 text-center">
                        {channel === 'inapp' ? (
                          <span className="text-small text-muted-foreground">
                            {t('inbox.preferences.alwaysOn')}
                          </span>
                        ) : (
                          <Switch
                            checked={row.enabled}
                            disabled={putPrefs.isPending}
                            onCheckedChange={() => toggle(row)}
                            aria-label={t('inbox.preferences.toggleAria', {
                              reason: t(`inbox.reason.${reason}`),
                              channel: t(`inbox.channel.${channel}`),
                            })}
                            className="mx-auto"
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {digestRowTelegram ? (
        <SectionCard title={t('inbox.preferences.digestFrequency')}>
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
            {digestRowTelegram ? (
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-small text-muted-foreground">
                  {t('inbox.channel.telegram')}
                </span>
                <select
                  value={
                    !digestRowTelegram.enabled
                      ? 'off'
                      : digestRowTelegram.digestMode === 'instant'
                        ? 'daily'
                        : digestRowTelegram.digestMode
                  }
                  disabled={putPrefs.isPending}
                  onChange={(e) =>
                    setDigestMode(digestRowTelegram, e.target.value as PrefRow['digestMode'])
                  }
                  className="h-10 rounded-sm border border-border bg-card px-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {PERSONAL_DIGEST_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`inbox.preferences.digestMode.${mode}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </>
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
    try {
      await putQuietHours.mutateAsync({ startMinute: null, endMinute: null, includeWeekends: null })
      setTouched(false)
      toast(t('inbox.preferences.saved'))
    } catch {
      toast(t('toast.saveError'))
    }
  }

  return (
    <SectionCard
      title={t('inbox.preferences.quietHours.title')}
      description={t(
        data.effective.source === 'department_default'
          ? 'inbox.preferences.quietHours.usingDepartmentDefault'
          : 'inbox.preferences.quietHours.usingPersonal',
        { range: formatMinuteRange(data.effective.startMinute, data.effective.endMinute) },
      )}
      actions={
        <>
          {usingOverride ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleUseDefault}
              disabled={putQuietHours.isPending}
            >
              {t('inbox.preferences.quietHours.useDefault')}
            </Button>
          ) : null}
          <Button size="sm" onClick={handleSave} loading={putQuietHours.isPending}>
            {t('inbox.preferences.save')}
          </Button>
        </>
      }
    >
      {/* The time-range picker (UI-OVERHAUL.md): two linked time fields read as one range, joined by
          a dash the way a calendar app's own range control reads. */}
      <div className="flex flex-wrap items-end gap-4">
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
        <span aria-hidden="true" className="pb-2.5 text-muted-foreground">
          –
        </span>
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
        <label className="flex items-center gap-2 pb-1.5">
          <Switch
            checked={weekends}
            onCheckedChange={(v) => {
              setTouched(true)
              setWeekends(v)
            }}
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
    </SectionCard>
  )
}

function CalendarFeedCard() {
  const t = useT()
  const [url, setUrl] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function handleReveal() {
    setPending(true)
    try {
      const result = await fetchIcsUrl()
      setUrl(new URL(result.url, window.location.origin).toString())
    } catch {
      toast(t('toast.saveError'))
    } finally {
      setPending(false)
    }
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
    <SectionCard
      title={t('inbox.preferences.calendar.title')}
      description={t('inbox.preferences.calendar.body')}
    >
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded-sm bg-muted px-2 py-1 text-caption">
            {url}
          </code>
          <Button size="sm" variant="secondary" onClick={handleCopy}>
            {t('inbox.preferences.calendar.copy')}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={handleReveal} loading={pending}>
          {t('inbox.preferences.calendar.reveal')}
        </Button>
      )}
    </SectionCard>
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
      <PageHeader
        eyebrow={t('inbox.eyebrow')}
        title={t('inbox.preferences.title')}
        description={t('inbox.preferences.body')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/inbox/telegram')}>
            {t('telegram.title')}
          </Button>
        }
      />

      <PrefsMatrixBody query={prefsQuery} />

      <QuietHoursCard departmentId={departmentId} />
      <CalendarFeedCard />
    </div>
  )
}
