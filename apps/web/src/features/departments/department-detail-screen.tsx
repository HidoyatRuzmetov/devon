// `/department?id=<uuid>` -- detail, settings, invite and membership management for one department
// (TECH-SPEC §2.2, §2.3). Query-string id, not a path param: `src/lib/router.tsx` supports exact
// paths only today (MODULE-GUIDE.md "Web features"); `useSearchParams()` is the documented way around
// that until a param route exists. Rebuilt to UI-OVERHAUL.md's Settings recipe (§9.5): a page header
// with tabs, one `SectionCard` per concern each with its own save, danger zone last with a full,
// typed-confirmation dialog -- replacing every `window.confirm()` the previous revision used.
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useT } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  DataList,
  DataRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  PageHeader,
  RadioGroup,
  RadioOption,
  Reveal,
  SectionCard,
  StateView,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  initialsFromName,
  toast,
} from '@devon/ui'
import { MoreVertical, RefreshCw } from 'lucide-react'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { useSearchParams, navigate } from '../../lib/router.js'
import { adminResetPassword } from '../accounts/api.js'
import { ConfirmDialog } from './components/confirm-dialog.js'
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
  const deptQuery = useQuery({
    queryKey: ['departments', 'detail', id],
    queryFn: () => fetchDepartment(id),
  })

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
    return <StateView kind="loading" titleKey="state.loading" compact />
  }
  if (deptQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => deptQuery.refetch() }}
        compact
      />
    )
  }

  return (
    <SectionCard
      title={t('departments.settings.permissionsTitle')}
      description={t('departments.settings.permissionsDescription')}
      actions={
        isHead ? (
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            {t('departments.settings.save')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <label className="flex items-center justify-between gap-4">
          <span className="text-body text-foreground">
            {t('departments.settings.allowSelfAssign')}
          </span>
          <Switch
            checked={allowSelfAssign}
            disabled={!isHead}
            onCheckedChange={setAllowSelfAssign}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="text-body text-foreground">
            {t('departments.settings.allowStructureEdit')}
          </span>
          <Switch
            checked={allowStructureEdit}
            disabled={!isHead}
            onCheckedChange={setAllowStructureEdit}
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-small text-foreground">
            {t('departments.settings.telegramGroupLabel')}
          </span>
          <RadioGroup
            value={telegramPerm}
            onValueChange={(v) => setTelegramPerm(v as typeof telegramPerm)}
          >
            <RadioOption
              value="everyone"
              label={t('departments.settings.telegramEveryone')}
              disabled={!isHead}
            />
            <RadioOption
              value="head"
              label={t('departments.settings.telegramHeadOnly')}
              disabled={!isHead}
            />
          </RadioGroup>
        </div>
      </div>
    </SectionCard>
  )
}

function InviteTab({ id }: { id: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const inviteQuery = useQuery({
    queryKey: ['departments', 'invite', id],
    queryFn: () => fetchInvite(id),
  })
  const [revealedPassword, setRevealedPassword] = React.useState<string | null>(null)
  const [customPassword, setCustomPassword] = React.useState('')
  const [confirmRotate, setConfirmRotate] = React.useState<'key' | 'password' | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['departments', 'invite', id] })

  const rotateKey = useMutation({
    mutationFn: () => rotateJoinKey(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      setConfirmRotate(null)
      void invalidate()
    },
  })
  const rotatePassword = useMutation({
    mutationFn: () => rotateJoinPassword(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: (result) => {
      setRevealedPassword(result.password)
      setConfirmRotate(null)
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

  if (inviteQuery.isPending) return <StateView kind="loading" titleKey="state.loading" compact />
  if (inviteQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => inviteQuery.refetch() }}
        compact
      />
    )
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
      <SectionCard
        title={t('departments.invite.title')}
        description={t('departments.invite.linkDescription')}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setConfirmRotate('key')}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('departments.invite.rotateKey')}
          </Button>
        }
      >
        {link ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input readOnly value={link} className="font-mono text-small" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => toast(t('departments.invite.copiedLink')))
                  }}
                >
                  {t('departments.invite.copyLink')}
                </Button>
              </div>
              <label className="flex items-center justify-between gap-4 pt-1">
                <span className="text-small text-foreground">
                  {t('departments.invite.approvalToggleLabel')}
                </span>
                <Switch
                  checked={invite.joinRequiresApproval}
                  onCheckedChange={(v) => toggleApproval.mutate(v)}
                />
              </label>
              <p className="text-caption text-muted-foreground">
                {t('departments.invite.approvalToggleBody')}
              </p>
            </div>
            {/* Fixed black-on-white, never theme tokens: a QR scanner needs the highest contrast the
                camera can find, not the current colour scheme. */}
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <div className="rounded-md border border-border bg-white p-3">
                <QRCodeSVG value={link} size={128} fgColor="#000000" bgColor="#ffffff" />
              </div>
              <span className="text-caption text-muted-foreground">
                {t('departments.invite.qrLabel')}
              </span>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('departments.invite.passwordLabel')}
        description={t('departments.invite.passwordHiddenNotice')}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setConfirmRotate('password')}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('departments.invite.rotatePassword')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {revealedPassword ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input readOnly value={revealedPassword} className="font-mono text-small" />
                <Button size="sm" onClick={copyInviteText}>
                  {t('departments.invite.copyInvite')}
                </Button>
              </div>
              <p className="text-caption text-attention-foreground">
                {t('departments.invite.saveNowWarning')}
              </p>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-small text-foreground">
                {t('departments.invite.setPassword')}
              </span>
              <Input
                type="password"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={!customPassword || setPassword.isPending}
              loading={setPassword.isPending}
              onClick={() => setPassword.mutate()}
            >
              {t('departments.invite.setPasswordSubmit')}
            </Button>
          </div>
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirmRotate !== null}
        onOpenChange={(open) => !open && setConfirmRotate(null)}
        title={t(
          confirmRotate === 'key'
            ? 'departments.invite.rotateKeyDialogTitle'
            : 'departments.invite.rotatePasswordDialogTitle',
        )}
        body={t(
          confirmRotate === 'key'
            ? 'departments.invite.rotateKeyConfirm'
            : 'departments.invite.rotatePasswordConfirm',
        )}
        confirmLabel={t(
          confirmRotate === 'key'
            ? 'departments.invite.rotateKey'
            : 'departments.invite.rotatePassword',
        )}
        cancelLabel={t('departments.common.cancel')}
        loading={confirmRotate === 'key' ? rotateKey.isPending : rotatePassword.isPending}
        onConfirm={() => (confirmRotate === 'key' ? rotateKey.mutate() : rotatePassword.mutate())}
      />
    </div>
  )
}

function MemberRow({
  member,
  isHead,
  isSuperAdmin,
  myUserId,
  onTransfer,
  onRemove,
  onLeave,
  onResetPassword,
  resetPasswordPending,
}: {
  member: Member
  isHead: boolean
  isSuperAdmin: boolean
  myUserId: string
  onTransfer: () => void
  onRemove: () => void
  onLeave: () => void
  onResetPassword: () => void
  resetPasswordPending: boolean
}) {
  const t = useT()
  const name = `${member.givenName} ${member.familyName}`
  const isMe = member.userId === myUserId
  const hasMenu = (isHead && !isMe) || (isSuperAdmin && !isMe)

  return (
    <DataRow
      leading={
        <Avatar
          size="sm"
          alt={name}
          initials={initialsFromName(member.givenName, member.familyName)}
          hueSeed={member.userId}
        />
      }
      trailing={
        <>
          {isMe ? (
            <Button size="sm" variant="ghost" onClick={onLeave}>
              {t('departments.members.leave')}
            </Button>
          ) : null}
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label={t('departments.members.title')}>
                  <MoreVertical className="size-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isHead && !isMe ? (
                  <>
                    <DropdownMenuItem onSelect={onTransfer}>
                      {t('departments.members.transfer')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onRemove}>
                      {t('departments.members.remove')}
                    </DropdownMenuItem>
                  </>
                ) : null}
                {isSuperAdmin && !isMe ? (
                  <DropdownMenuItem disabled={resetPasswordPending} onSelect={onResetPassword}>
                    {t('accounts.admin.resetPassword.button')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
    >
      <div className="min-w-0">
        <p className="truncate text-body text-foreground">
          {name}{' '}
          {member.title ? <span className="text-muted-foreground">· {member.title}</span> : null}
        </p>
        <span className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <Badge
            tone={member.role === 'head' ? 'primary' : 'neutral'}
            variant={member.role === 'head' ? 'outline' : 'subtle'}
          >
            {t(
              member.role === 'head'
                ? 'departments.members.roleHead'
                : 'departments.members.roleMember',
            )}
          </Badge>
          {member.status === 'pending_approval' ? (
            <Badge tone="warning">{t('departments.members.statusPending')}</Badge>
          ) : null}
          {t('departments.members.joinedAt', {
            date: new Date(member.joinedAt).toLocaleDateString(),
          })}
        </span>
      </div>
    </DataRow>
  )
}

function MembersTab({ id, isHead, myUserId }: { id: string; isHead: boolean; myUserId: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const membersQuery = useQuery({
    queryKey: ['departments', 'members', id],
    queryFn: () => fetchMembers(id),
  })
  const isSuperAdmin = meQuery.data?.user.role === 'super_admin'
  const [tempPassword, setTempPassword] = React.useState<string | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<{
    kind: 'transfer' | 'remove' | 'leave' | 'resetPassword'
    member?: Member
  } | null>(null)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['departments', 'members', id] })
    void queryClient.invalidateQueries({ queryKey: ['departments', 'mine'] })
  }
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(id, userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.members.removedToast'))
      setConfirmAction(null)
      invalidate()
    },
  })
  const transfer = useMutation({
    mutationFn: (userId: string) => transferHeadship(id, userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.members.transferredToast'))
      setConfirmAction(null)
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
  // TECH-SPEC §2.1: super-admin-only, instance-scoped password reset (route permission is
  // `{action:'administer', subject:{kind:'instance'}}`, never a department permission) -- surfaced
  // here because the member list is the one screen a super admin already has every user in front of.
  const resetPassword = useMutation({
    mutationFn: (userId: string) => adminResetPassword(userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: (result) => {
      toast(t('accounts.admin.resetPassword.success'))
      setConfirmAction(null)
      setTempPassword(result.temporaryPassword)
    },
  })

  if (membersQuery.isPending) return <StateView kind="loading" titleKey="state.loading" compact />
  if (membersQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => membersQuery.refetch() }}
        compact
      />
    )
  }

  const members = membersQuery.data.members

  return (
    <div className="flex flex-col gap-4">
      {members.length === 0 ? (
        <StateView kind="empty" titleKey="departments.members.empty.title" compact />
      ) : (
        <Reveal>
          <DataList label={t('departments.members.title')}>
            {members.map((m: Member) => (
              <MemberRow
                key={m.userId}
                member={m}
                isHead={isHead}
                isSuperAdmin={isSuperAdmin}
                myUserId={myUserId}
                resetPasswordPending={resetPassword.isPending}
                onTransfer={() => setConfirmAction({ kind: 'transfer', member: m })}
                onRemove={() => setConfirmAction({ kind: 'remove', member: m })}
                onLeave={() => setConfirmAction({ kind: 'leave' })}
                onResetPassword={() => setConfirmAction({ kind: 'resetPassword', member: m })}
              />
            ))}
          </DataList>
        </Reveal>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        destructive={confirmAction?.kind === 'remove' || confirmAction?.kind === 'leave'}
        title={t(
          confirmAction?.kind === 'transfer'
            ? 'departments.members.transferDialogTitle'
            : confirmAction?.kind === 'remove'
              ? 'departments.members.removeDialogTitle'
              : confirmAction?.kind === 'resetPassword'
                ? 'accounts.admin.resetPassword.title'
                : 'departments.members.leaveDialogTitle',
        )}
        body={
          confirmAction?.kind === 'transfer'
            ? t('departments.members.transferConfirm', {
                name: confirmAction.member
                  ? `${confirmAction.member.givenName} ${confirmAction.member.familyName}`
                  : '',
              })
            : confirmAction?.kind === 'remove'
              ? t('departments.members.removeConfirm', {
                  name: confirmAction.member
                    ? `${confirmAction.member.givenName} ${confirmAction.member.familyName}`
                    : '',
                })
              : confirmAction?.kind === 'resetPassword'
                ? t('accounts.admin.resetPassword.confirm')
                : t('departments.members.leaveConfirm')
        }
        confirmLabel={t(
          confirmAction?.kind === 'transfer'
            ? 'departments.members.transfer'
            : confirmAction?.kind === 'remove'
              ? 'departments.members.remove'
              : confirmAction?.kind === 'resetPassword'
                ? 'accounts.admin.resetPassword.button'
                : 'departments.members.leave',
        )}
        cancelLabel={t('departments.common.cancel')}
        loading={
          transfer.isPending || remove.isPending || leave.isPending || resetPassword.isPending
        }
        onConfirm={() => {
          if (!confirmAction) return
          if (confirmAction.kind === 'transfer' && confirmAction.member)
            transfer.mutate(confirmAction.member.userId)
          else if (confirmAction.kind === 'remove' && confirmAction.member)
            remove.mutate(confirmAction.member.userId)
          else if (confirmAction.kind === 'resetPassword' && confirmAction.member)
            resetPassword.mutate(confirmAction.member.userId)
          else if (confirmAction.kind === 'leave') leave.mutate()
        }}
      />

      <ConfirmDialog
        open={tempPassword !== null}
        onOpenChange={(open) => !open && setTempPassword(null)}
        title={t('accounts.admin.resetPassword.title')}
        body={
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-foreground">
              {t('accounts.admin.resetPassword.tempPasswordLabel')}
            </span>
            <code className="break-all rounded-sm border border-border bg-muted px-2 py-1.5 text-body">
              {tempPassword}
            </code>
          </div>
        }
        confirmLabel={t('accounts.admin.resetPassword.copy')}
        cancelLabel={t('departments.common.cancel')}
        onConfirm={async () => {
          if (tempPassword) await navigator.clipboard.writeText(tempPassword)
          toast(t('accounts.admin.resetPassword.copied'))
          setTempPassword(null)
        }}
      />
    </div>
  )
}

function DangerTab({ id, departmentName }: { id: string; departmentName: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const request = useMutation({
    mutationFn: () => requestDepartmentDeletion(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.settings.deletionRequested'))
      setConfirmOpen(false)
    },
  })
  return (
    <SectionCard
      title={t('departments.settings.dangerZone')}
      description={t('departments.settings.dangerZoneDescription')}
      className="border-destructive/40"
    >
      <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
        {t('departments.settings.requestDeletion')}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title={t('departments.settings.requestDeletion')}
        body={t('departments.settings.requestDeletionConfirm')}
        confirmLabel={t('departments.settings.requestDeletion')}
        cancelLabel={t('departments.common.cancel')}
        loading={request.isPending}
        onConfirm={() => request.mutate()}
        typedConfirmValue={departmentName}
        typedConfirmLabel={t('departments.settings.typedConfirmLabel', { name: departmentName })}
      />
    </SectionCard>
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
      return (
        <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
      )
    }
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => deptQuery.refetch() }}
      />
    )
  }

  const dept = deptQuery.data
  const isHead = dept.myRole === 'head'
  const myUserId = meQuery.data?.user.id ?? ''

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('departments.title')}
        title={`${dept.emoji ? `${dept.emoji} ` : ''}${dept.name}`}
        tabs={
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="general">{t('departments.settings.general')}</TabsTrigger>
              {isHead ? (
                <TabsTrigger value="invite">{t('departments.invite.title')}</TabsTrigger>
              ) : null}
              <TabsTrigger value="members">{t('departments.members.title')}</TabsTrigger>
              {isHead ? (
                <TabsTrigger value="danger">{t('departments.settings.dangerZone')}</TabsTrigger>
              ) : null}
            </TabsList>
          </Tabs>
        }
      />

      {tab === 'general' ? <GeneralTab id={id} isHead={isHead} /> : null}
      {tab === 'invite' && isHead ? <InviteTab id={id} /> : null}
      {tab === 'members' ? <MembersTab id={id} isHead={isHead} myUserId={myUserId} /> : null}
      {tab === 'danger' && isHead ? <DangerTab id={id} departmentName={dept.name} /> : null}
    </div>
  )
}
