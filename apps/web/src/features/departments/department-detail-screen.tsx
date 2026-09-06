// `/department?id=<uuid>` -- detail, settings, invite and membership management for one department
// (TECH-SPEC §2.2, §2.3). Query-string id, not a path param: `src/lib/router.tsx` supports exact
// paths only today (MODULE-GUIDE.md "Web features"); `useSearchParams()` is the documented way around
// that until a param route exists.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Badge, Button, Input, Separator, StateView, toast } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { useSearchParams, navigate } from '../../lib/router.js'
import {
  fetchDepartment,
  fetchInvite,
  fetchMembers,
  leaveDepartment,
  patchDepartmentSettings,
  removeMember,
  requestDepartmentDeletion,
  rotateJoinKey,
  rotateJoinPassword,
  setJoinApproval,
  setJoinPassword,
  transferHeadship,
  type Member,
} from './api.js'

type Tab = 'general' | 'invite' | 'members' | 'danger'

function GeneralTab({ id, isHead }: { id: string; isHead: boolean }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const deptQuery = useQuery({ queryKey: ['departments', 'detail', id], queryFn: () => fetchDepartment(id) })

  const [allowSelfAssign, setAllowSelfAssign] = React.useState(true)
  const [allowStructureEdit, setAllowStructureEdit] = React.useState(true)
  const [telegramPerm, setTelegramPerm] = React.useState<'everyone' | 'head'>('everyone')

  React.useEffect(() => {
    if (deptQuery.data) {
      setAllowSelfAssign(deptQuery.data.settings.allowSelfAssign)
      setAllowStructureEdit(deptQuery.data.settings.allowStructureEdit)
      setTelegramPerm(deptQuery.data.settings.whoCanConnectTelegramGroup)
    }
  }, [deptQuery.data])

  const save = useMutation({
    mutationFn: () =>
      patchDepartmentSettings(
        id,
        { allowSelfAssign, allowStructureEdit, whoCanConnectTelegramGroup: telegramPerm },
        meQuery.data?.csrfToken ?? '',
      ),
    onSuccess: () => {
      toast(t('departments.settings.saved'))
      void queryClient.invalidateQueries({ queryKey: ['departments', 'detail', id] })
    },
  })

  if (deptQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (deptQuery.isError) {
    return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-body text-foreground">
        <input
          type="checkbox"
          checked={allowSelfAssign}
          disabled={!isHead}
          onChange={(e) => setAllowSelfAssign(e.target.checked)}
        />
        {t('departments.settings.allowSelfAssign')}
      </label>
      <label className="flex items-center gap-2 text-body text-foreground">
        <input
          type="checkbox"
          checked={allowStructureEdit}
          disabled={!isHead}
          onChange={(e) => setAllowStructureEdit(e.target.checked)}
        />
        {t('departments.settings.allowStructureEdit')}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-small text-foreground">{t('departments.settings.telegramGroupLabel')}</span>
        <select
          className="h-11 w-fit rounded-sm border border-border bg-card px-3 text-body text-foreground"
          value={telegramPerm}
          disabled={!isHead}
          onChange={(e) => setTelegramPerm(e.target.value as 'everyone' | 'head')}
        >
          <option value="everyone">{t('departments.settings.telegramEveryone')}</option>
          <option value="head">{t('departments.settings.telegramHeadOnly')}</option>
        </select>
      </label>
      {isHead ? (
        <Button size="sm" className="w-fit" loading={save.isPending} onClick={() => save.mutate()}>
          {t('departments.settings.saved')}
        </Button>
      ) : null}
    </div>
  )
}

function InviteTab({ id }: { id: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const inviteQuery = useQuery({ queryKey: ['departments', 'invite', id], queryFn: () => fetchInvite(id) })
  const [revealedPassword, setRevealedPassword] = React.useState<string | null>(null)
  const [customPassword, setCustomPassword] = React.useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['departments', 'invite', id] })

  const rotateKey = useMutation({
    mutationFn: () => rotateJoinKey(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => invalidate(),
  })
  const rotatePassword = useMutation({
    mutationFn: () => rotateJoinPassword(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: (result) => {
      setRevealedPassword(result.password)
      void invalidate()
    },
  })
  const setPassword = useMutation({
    mutationFn: () => setJoinPassword(id, customPassword, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      setRevealedPassword(customPassword)
      setCustomPassword('')
      void invalidate()
    },
  })
  const toggleApproval = useMutation({
    mutationFn: (value: boolean) => setJoinApproval(id, value, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => invalidate(),
  })

  if (inviteQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (inviteQuery.isError) {
    return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  }

  const invite = inviteQuery.data
  const link = invite.joinKey ? `${window.location.origin}/join?key=${invite.joinKey}` : null

  function copyInviteText() {
    if (!link || !revealedPassword) return
    const text = t('departments.invite.inviteText', { link, password: revealedPassword })
    void navigator.clipboard.writeText(text).then(() => toast(t('departments.invite.copiedInvite')))
  }

  return (
    <div className="flex flex-col gap-5">
      {link ? (
        <div className="flex flex-col gap-2">
          <span className="text-small text-foreground">{t('departments.invite.link')}</span>
          <div className="flex items-center gap-2">
            <Input readOnly value={link} className="font-mono text-small" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => toast(t('departments.invite.copiedLink')))
              }}
            >
              {t('departments.invite.copiedLink')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-small text-foreground">{t('departments.invite.passwordLabel')}</span>
        {revealedPassword ? (
          <div className="flex items-center gap-2">
            <Input readOnly value={revealedPassword} className="font-mono text-small" />
            <Button size="sm" onClick={copyInviteText}>
              {t('departments.invite.copyInvite')}
            </Button>
          </div>
        ) : (
          <p className="text-small text-muted-foreground">{t('departments.invite.passwordHiddenNotice')}</p>
        )}
        {revealedPassword ? (
          <p className="text-small text-attention-foreground">{t('departments.invite.saveNowWarning')}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={rotateKey.isPending}
          onClick={() => {
            if (window.confirm(t('departments.invite.rotateKeyConfirm'))) rotateKey.mutate()
          }}
        >
          {t('departments.invite.rotateKey')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={rotatePassword.isPending}
          onClick={() => {
            if (window.confirm(t('departments.invite.rotatePasswordConfirm'))) rotatePassword.mutate()
          }}
        >
          {t('departments.invite.rotatePassword')}
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-small text-foreground">{t('departments.invite.setPassword')}</span>
          <Input
            type="password"
            value={customPassword}
            onChange={(e) => setCustomPassword(e.target.value)}
          />
        </label>
        <Button size="sm" loading={setPassword.isPending} onClick={() => setPassword.mutate()}>
          {t('departments.invite.setPasswordSubmit')}
        </Button>
      </div>

      <label className="flex items-center gap-2 text-body text-foreground">
        <input
          type="checkbox"
          checked={invite.joinRequiresApproval}
          onChange={(e) => toggleApproval.mutate(e.target.checked)}
        />
        <span className="flex flex-col">
          <span>{t('departments.invite.approvalToggleLabel')}</span>
          <span className="text-small text-muted-foreground">{t('departments.invite.approvalToggleBody')}</span>
        </span>
      </label>
    </div>
  )
}

function MembersTab({ id, isHead, myUserId }: { id: string; isHead: boolean; myUserId: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const membersQuery = useQuery({ queryKey: ['departments', 'members', id], queryFn: () => fetchMembers(id) })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['departments', 'members', id] })
    void queryClient.invalidateQueries({ queryKey: ['departments', 'mine'] })
  }
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(id, userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.members.removedToast'))
      invalidate()
    },
  })
  const transfer = useMutation({
    mutationFn: (userId: string) => transferHeadship(id, userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.members.transferredToast'))
      invalidate()
    },
  })
  const leave = useMutation({
    mutationFn: () => leaveDepartment(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.members.leftToast'))
      navigate('/departments')
    },
    onError: () => toast(t('departments.members.leaveBlockedHead')),
  })

  if (membersQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (membersQuery.isError) {
    return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  }

  const members = membersQuery.data.members

  return (
    <div className="flex flex-col gap-4">
      {members.length === 0 ? (
        <StateView kind="empty" titleKey="departments.members.empty.title" />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {members.map((m: Member) => {
            const name = `${m.givenName} ${m.familyName}`
            return (
              <li key={m.userId} className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-body text-foreground">
                    {name} {m.title ? <span className="text-muted-foreground">· {m.title}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-small text-muted-foreground">
                    <Badge tone={m.role === 'head' ? 'info' : 'neutral'}>
                      {t(m.role === 'head' ? 'departments.members.roleHead' : 'departments.members.roleMember')}
                    </Badge>
                    {m.status === 'pending_approval' ? (
                      <Badge tone="warning">{t('departments.members.statusPending')}</Badge>
                    ) : null}
                    {t('departments.members.joinedAt', { date: new Date(m.joinedAt).toLocaleDateString() })}
                  </span>
                </div>
                <div className="flex gap-2">
                  {isHead && m.userId !== myUserId ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(t('departments.members.transferConfirm', { name }))) {
                            transfer.mutate(m.userId)
                          }
                        }}
                      >
                        {t('departments.members.transfer')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(t('departments.members.removeConfirm', { name }))) {
                            remove.mutate(m.userId)
                          }
                        }}
                      >
                        {t('departments.members.remove')}
                      </Button>
                    </>
                  ) : null}
                  {m.userId === myUserId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(t('departments.members.leaveConfirm'))) leave.mutate()
                      }}
                    >
                      {t('departments.members.leave')}
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DangerTab({ id }: { id: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const request = useMutation({
    mutationFn: () => requestDepartmentDeletion(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => toast(t('departments.settings.deletionRequested')),
  })
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-h3 text-destructive">{t('departments.settings.dangerZone')}</h3>
      <Button
        variant="destructive"
        size="sm"
        className="w-fit"
        loading={request.isPending}
        onClick={() => {
          if (window.confirm(t('departments.settings.requestDeletionConfirm'))) request.mutate()
        }}
      >
        {t('departments.settings.requestDeletion')}
      </Button>
    </div>
  )
}

export default function DepartmentDetailScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [tab, setTab] = React.useState<Tab>('general')

  const deptQuery = useQuery({
    queryKey: ['departments', 'detail', id],
    queryFn: () => fetchDepartment(id),
    enabled: id.length > 0,
  })

  if (!id) return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  if (deptQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (deptQuery.isError) {
    if (deptQuery.error instanceof ApiError && deptQuery.error.status === 403) {
      return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
    }
    return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  }

  const dept = deptQuery.data
  const isHead = dept.myRole === 'head'
  const myUserId = meQuery.data?.user.id ?? ''

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: t('departments.settings.general') },
    ...(isHead ? [{ id: 'invite' as const, label: t('departments.invite.title') }] : []),
    { id: 'members', label: t('departments.members.title') },
    ...(isHead ? [{ id: 'danger' as const, label: t('departments.settings.dangerZone') }] : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h2 text-foreground">
          {dept.emoji ? `${dept.emoji} ` : ''}
          {dept.name}
        </h1>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tItem) => (
          <button
            key={tItem.id}
            type="button"
            className={`px-3 py-2 text-small ${tab === tItem.id ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}
            onClick={() => setTab(tItem.id)}
          >
            {tItem.label}
          </button>
        ))}
      </div>

      <Separator className="sr-only" />

      {tab === 'general' ? <GeneralTab id={id} isHead={isHead} /> : null}
      {tab === 'invite' && isHead ? <InviteTab id={id} /> : null}
      {tab === 'members' ? <MembersTab id={id} isHead={isHead} myUserId={myUserId} /> : null}
      {tab === 'danger' && isHead ? <DangerTab id={id} /> : null}
    </div>
  )
}
