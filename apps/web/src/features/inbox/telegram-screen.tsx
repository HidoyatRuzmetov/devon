// `/inbox/telegram` (this module's task: "linking via /start <code> + QR in Settings" + "department
// group connection"). Personal linking is every signed-in user's own card; the group-connection card
// only renders for the head of the active department (the same `department`-subject write the API
// itself requires, `apps/api/src/modules/telegram/index.ts`) -- a member sees just their own link.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Badge, Button, IconButton, StateView, toast } from '@devon/ui'
import { Check, Copy, ExternalLink, Trash2, Unlink } from 'lucide-react'
import { useForcedState } from '../../lib/forced-state.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { GROUP_KINDS, type GroupKind, type TelegramGroupDto } from './api.js'
import {
  useDepartmentGroupsQuery,
  useDisconnectGroupMutation,
  useGroupConnectCodeMutation,
  usePutGroupKindsMutation,
  useTelegramLinkCodeMutation,
  useTelegramMuteMutation,
  useTelegramStatusQuery,
  useTelegramUnlinkMutation,
} from './hooks.js'

const MUTE_PRESETS = [30, 120, 480, 0] as const

function PersonalLinkCard() {
  const t = useT()
  const statusQuery = useTelegramStatusQuery()
  const linkCode = useTelegramLinkCodeMutation()
  const unlink = useTelegramUnlinkMutation()
  const mute = useTelegramMuteMutation()

  if (statusQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (statusQuery.isError || !statusQuery.data) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => statusQuery.refetch() }}
      />
    )
  }

  const status = statusQuery.data
  if (!status.botUsername) {
    return (
      <div className="rounded-md border border-border bg-card p-4">
        <h2 className="text-h3 text-foreground">{t('telegram.personal.title')}</h2>
        <StateView
          kind="empty"
          titleKey="telegram.notConfigured.title"
          bodyKey="telegram.notConfigured.body"
          className="mt-3"
        />
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3 text-foreground">{t('telegram.personal.title')}</h2>
        <Badge tone={status.linked ? 'success' : 'neutral'}>
          {status.linked ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Unlink className="size-3.5" aria-hidden="true" />
          )}
          {t(status.linked ? 'telegram.personal.linkedBadge' : 'telegram.personal.notLinkedBadge')}
        </Badge>
      </div>

      {status.linked ? (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <h3 className="text-h4 text-foreground">{t('telegram.personal.mute.title')}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {MUTE_PRESETS.map((minutes) => (
                <Button
                  key={minutes}
                  size="sm"
                  variant="secondary"
                  loading={mute.isPending && mute.variables === minutes}
                  onClick={() => {
                    mute.mutate(minutes, {
                      onSuccess: () => toast(t('telegram.personal.mute.applied')),
                    })
                  }}
                >
                  {t(
                    minutes === 0
                      ? 'telegram.personal.mute.off'
                      : 'telegram.personal.mute.forMinutes',
                    {
                      minutes,
                    },
                  )}
                </Button>
              ))}
            </div>
            {status.mutedUntil ? (
              <p className="mt-2 text-small text-muted-foreground">
                {t('telegram.personal.mute.until', {
                  date: new Date(status.mutedUntil).toLocaleString(),
                })}
              </p>
            ) : null}
          </div>
          <div>
            <Button
              variant="ghost"
              onClick={() =>
                unlink.mutate(undefined, {
                  onSuccess: () => toast(t('telegram.personal.unlinked')),
                })
              }
              loading={unlink.isPending}
            >
              <Unlink className="size-4" aria-hidden="true" />
              {t('telegram.personal.unlink')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-body text-muted-foreground">{t('telegram.personal.codeBody')}</p>
          {linkCode.data ? (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              {linkCode.data.qrDataUrl ? (
                <img
                  src={linkCode.data.qrDataUrl}
                  alt={t('telegram.personal.qrAlt')}
                  className="size-40 rounded-md border border-border bg-card p-2"
                />
              ) : null}
              <div className="flex flex-col gap-2">
                <code className="rounded-sm bg-muted px-3 py-2 text-h4 tracking-widest">
                  {linkCode.data.code}
                </code>
                {linkCode.data.deepLink ? (
                  <Button asChild size="sm" variant="secondary">
                    <a href={linkCode.data.deepLink} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" aria-hidden="true" />
                      {t('telegram.personal.openInTelegram')}
                    </a>
                  </Button>
                ) : null}
                <p className="text-caption text-muted-foreground">
                  {t('telegram.personal.codeExpires', {
                    time: new Date(linkCode.data.expiresAt).toLocaleTimeString(),
                  })}
                </p>
              </div>
            </div>
          ) : null}
          <div>
            <Button onClick={() => linkCode.mutate()} loading={linkCode.isPending}>
              {t('telegram.personal.connectButton')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function GroupRow({
  group,
  onToggleKind,
  onDisconnect,
  disconnecting,
}: {
  group: TelegramGroupDto
  onToggleKind: (kind: GroupKind, on: boolean) => void
  onDisconnect: () => void
  disconnecting: boolean
}) {
  const t = useT()
  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body font-medium text-foreground">
          {group.title ?? t('telegram.group.untitled')}
        </span>
        <IconButton
          aria-label={t('telegram.group.disconnect')}
          onClick={onDisconnect}
          disabled={disconnecting}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-3">
        {GROUP_KINDS.map((kind) => {
          const checked = group.kinds.includes(kind)
          return (
            <label key={kind} className="flex items-center gap-1.5 text-small text-foreground">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggleKind(kind, e.target.checked)}
                className="size-3.5 rounded-sm border-border"
              />
              {t(`telegram.group.kinds.${kind}`)}
            </label>
          )
        })}
      </div>
    </li>
  )
}

type GroupsListProps = { query: ReturnType<typeof useDepartmentGroupsQuery> } & {
  disconnect: ReturnType<typeof useDisconnectGroupMutation>
} & { putKinds: ReturnType<typeof usePutGroupKindsMutation> }

function GroupsList({ query, disconnect, putKinds }: GroupsListProps) {
  const t = useT()
  if (query.isPending) {
    return <StateView kind="loading" titleKey="state.loading" className="mt-3" />
  }
  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
        className="mt-3"
      />
    )
  }
  if (query.data.items.length === 0) {
    return (
      <StateView
        kind="empty"
        titleKey="telegram.group.empty.title"
        bodyKey="telegram.group.empty.body"
        className="mt-3"
      />
    )
  }
  return (
    <ul className="mt-3">
      {query.data.items.map((group) => (
        <GroupRow
          key={group.id}
          group={group}
          disconnecting={disconnect.isPending && disconnect.variables === group.id}
          onDisconnect={() =>
            disconnect.mutate(group.id, {
              onSuccess: () => toast(t('telegram.group.disconnected')),
            })
          }
          onToggleKind={(kind, on) => {
            const kinds = on ? [...group.kinds, kind] : group.kinds.filter((k) => k !== kind)
            putKinds.mutate(
              { groupId: group.id, kinds },
              { onSuccess: () => toast(t('telegram.group.updated')) },
            )
          }}
        />
      ))}
    </ul>
  )
}

function GroupsCard({ departmentId }: { departmentId: string }) {
  const t = useT()
  const groupsQuery = useDepartmentGroupsQuery(departmentId)
  const connectCode = useGroupConnectCodeMutation(departmentId)
  const putKinds = usePutGroupKindsMutation(departmentId)
  const disconnect = useDisconnectGroupMutation(departmentId)

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h2 className="text-h3 text-foreground">{t('telegram.group.title')}</h2>
      <p className="mt-1 text-body text-muted-foreground">{t('telegram.group.body')}</p>

      <GroupsList query={groupsQuery} disconnect={disconnect} putKinds={putKinds} />

      <div className="mt-4 flex flex-col gap-3">
        {connectCode.data ? (
          <div className="rounded-sm bg-muted p-3">
            <p className="text-small text-muted-foreground">{t('telegram.group.codeBody')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="text-h4 tracking-widest">{connectCode.data.code}</code>
              <IconButton
                aria-label={t('telegram.group.copyCode')}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(connectCode.data!.code)
                    toast(t('toast.copied'))
                  } catch {
                    toast(t('toast.saveError'))
                  }
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            <p className="mt-1 text-caption text-muted-foreground">
              {t('telegram.group.codeExpires', {
                time: new Date(connectCode.data.expiresAt).toLocaleTimeString(),
              })}
            </p>
          </div>
        ) : null}
        <div>
          <Button
            variant="secondary"
            onClick={() => connectCode.mutate()}
            loading={connectCode.isPending}
          >
            {t('telegram.group.connectButton')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function TelegramScreen() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const { department, departmentId } = useDepartment()

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

  if (!online) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }

  const isHead = department?.role === 'head'

  return (
    <div className="mx-auto flex max-w-160 flex-col gap-6">
      <div>
        <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('inbox.eyebrow')}
        </p>
        <h1 className="font-display text-h1 text-foreground">{t('telegram.title')}</h1>
      </div>

      <PersonalLinkCard />

      {isHead && departmentId ? <GroupsCard departmentId={departmentId} /> : null}
    </div>
  )
}
