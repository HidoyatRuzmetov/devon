// Web push opt-in (v1.1 SPEC §10, EPIC-019).
//
// The opt-in is *per browser*, and the panel says so everywhere rather than pretending there is one
// global switch: a person's phone and their desk machine are separate subscriptions, each granted by
// its own browser prompt, each revocable on its own. Pretending otherwise would mean a switch that
// looks on while the device in your hand is silent.
//
// Every "it didn't work" path has its own designed state with words a person can act on -- browser
// too old, permission blocked, server has no VAPID keys, prompt dismissed. A grey disabled button
// with no explanation is the thing this panel exists to avoid.
import * as React from 'react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Badge,
  Button,
  Card,
  Reveal,
  SectionCard,
  Stagger,
  StaggerItem,
  StateView,
  toast,
} from '@devon/ui'
import { AtSign, BellRing, CalendarClock, CheckCircle2, Gavel, Moon, UserPlus } from 'lucide-react'
import { ApiError } from '../../../lib/api-client.js'
import { useOnline } from '../../../lib/use-online.js'
import {
  useDisablePush,
  useEnablePush,
  usePushDevicesQuery,
  usePushKeyQuery,
  usePushState,
  usePushSubscriptionRepair,
} from '../hooks.js'
import { describeThisBrowser } from '../lib/push-client.js'

const REASONS = [
  { key: 'mentioned', icon: AtSign },
  { key: 'assigned', icon: UserPlus },
  { key: 'due', icon: CalendarClock },
  { key: 'decision', icon: Gavel },
] as const

export function PushPanel(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const online = useOnline()

  const keyQuery = usePushKeyQuery()
  const devicesQuery = usePushDevicesQuery()
  const push = usePushState()
  const enable = useEnablePush()
  const disable = useDisablePush()

  // Repair this browser's server-side row once per visit -- see the hook's own comment for why an
  // endpoint can drift out from under us.
  usePushSubscriptionRepair(locale, push.enabledHere && !push.loading)

  const thisBrowser = describeThisBrowser()

  function turnOn(): void {
    const publicKey = keyQuery.data?.publicKey ?? ''
    enable.mutate(
      { publicKey, locale },
      {
        onSuccess: (outcome) => {
          push.refresh()
          if (outcome.ok) {
            toast.success(t('calendar.push.toast.enabled'))
            return
          }
          // A dismissed prompt is not a failure worth an alarming message: the person can simply
          // press the button again. A real refusal or an unsupported browser is already described
          // by the state block below, which `push.refresh()` has just re-read.
          if (outcome.reason === 'failed') toast.error(t('calendar.push.toast.failed'))
        },
        onError: () => {
          push.refresh()
          toast.error(t('calendar.push.toast.failed'))
        },
      },
    )
  }

  function turnOff(): void {
    disable.mutate(undefined, {
      onSuccess: () => {
        push.refresh()
        toast.success(t('calendar.push.toast.disabled'))
      },
    })
  }

  function control(): React.JSX.Element {
    if (!online && devicesQuery.data === undefined) {
      return (
        <StateView
          kind="offline"
          titleKey="calendar.offline.title"
          bodyKey="calendar.offline.body"
          action={{ labelKey: 'calendar.actions.retry', onAction: () => void keyQuery.refetch() }}
        />
      )
    }
    if (keyQuery.isPending || push.loading) {
      return <StateView kind="loading" titleKey="calendar.push.loading.title" />
    }
    if (keyQuery.isError) {
      const err = keyQuery.error
      const requestId = err instanceof ApiError && err.requestId ? err.requestId : null
      return (
        <StateView
          kind="error"
          titleKey="calendar.push.error.title"
          bodyKey="calendar.push.error.body"
          action={{ labelKey: 'calendar.actions.retry', onAction: () => void keyQuery.refetch() }}
          {...(requestId ? { requestId } : {})}
        />
      )
    }
    // The operator has not enabled VAPID on this box. Nothing the person can do -- say so plainly
    // rather than offering a button that will always fail.
    if (!keyQuery.data.enabled) {
      return (
        <StateView
          kind="empty"
          titleKey="calendar.push.disabledOnServer.title"
          bodyKey="calendar.push.disabledOnServer.body"
          compact
        />
      )
    }
    if (push.support === 'unsupported') {
      return (
        <StateView
          kind="empty"
          titleKey="calendar.push.unsupported.title"
          bodyKey="calendar.push.unsupported.body"
          compact
        />
      )
    }
    if (push.support === 'denied') {
      return (
        <StateView
          kind="forbidden"
          titleKey="calendar.push.denied.title"
          bodyKey="calendar.push.denied.body"
          compact
        />
      )
    }

    return (
      <div className="flex flex-wrap items-center gap-3">
        {push.enabledHere ? (
          <>
            <Badge tone="success">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {t('calendar.push.state.on')}
            </Badge>
            <Button variant="ghost" loading={disable.isPending} onClick={turnOff}>
              {t('calendar.push.disable')}
            </Button>
          </>
        ) : (
          <>
            <Badge tone="neutral">{t('calendar.push.state.off')}</Badge>
            <Button variant="primary" loading={enable.isPending} onClick={turnOn}>
              <BellRing aria-hidden="true" className="size-4" />
              {enable.isPending ? t('calendar.push.enabling') : t('calendar.push.enable')}
            </Button>
          </>
        )}
      </div>
    )
  }

  function devices(): React.JSX.Element | null {
    if (devicesQuery.isPending || devicesQuery.isError) return null
    const items = devicesQuery.data.items
    if (items.length === 0) return null
    return (
      <SectionCard title={t('calendar.push.devices.title')}>
        <Stagger as="ul" animateKey={items.length} className="flex flex-col gap-2 pt-2">
          {items.map((device) => {
            const isThis = push.enabledHere && device.browserLabel === thisBrowser
            return (
              <StaggerItem as="li" key={device.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2">
                  <span className="flex items-center gap-2 text-body text-foreground">
                    {device.browserLabel || t('calendar.push.devices.unknown')}
                    {isThis ? (
                      <Badge tone="neutral">{t('calendar.push.devices.thisDevice')}</Badge>
                    ) : null}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {t('calendar.push.devices.lastSeen', {
                      date: formatDate(new Date(device.lastSeenAt), locale),
                    })}
                  </span>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      </SectionCard>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 text-foreground">{t('calendar.push.title')}</h2>
        <p className="text-body text-muted-foreground">{t('calendar.push.description')}</p>
      </div>

      <Card className="flex flex-col gap-5">
        {control()}

        <div className="flex flex-col gap-2">
          <h3 className="text-caption font-medium text-foreground">
            {t('calendar.push.what.title')}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {REASONS.map(({ key, icon: Icon }) => (
              <li
                key={key}
                className="flex items-center gap-2 text-body text-muted-foreground"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {t(`calendar.push.what.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        <Reveal onView>
          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <Moon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('calendar.push.quietHours.note')}
          </p>
        </Reveal>
      </Card>

      {devices()}
    </div>
  )
}

export default PushPanel
