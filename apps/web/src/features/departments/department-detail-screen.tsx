// `/department?id=<uuid>` -- detail, settings, invite and membership management for one department
// (TECH-SPEC §2.2, §2.3). Query-string id, not a path param: `src/lib/router.tsx` supports exact
// paths only today (MODULE-GUIDE.md "Web features"); `useSearchParams()` is the documented way around
// that until a param route exists. Rebuilt to UI-OVERHAUL.md's Settings recipe (§9.5): a page header
// with tabs, one `SectionCard` per concern each with its own save, danger zone last with a full,
// typed-confirmation dialog -- replacing every `window.confirm()` the previous revision used.
import * as React from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  Celebrate,
  DataList,
  DataRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  initialsFromName,
  Input,
  PageHeader,
  RadioGroup,
  RadioOption,
  ReadOnlyStrip,
  Reveal,
  SectionCard,
  StateView,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@devon/ui'
import { Copy, Lock, MoreVertical, RefreshCw } from 'lucide-react'
import { FEATURES, FEATURE_KEYS, type FeatureKey } from '@devon/contracts'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery, useDepartment } from '../../lib/session.js'
import { useSearchParams, navigate } from '../../lib/router.js'
import { adminResetPassword } from '../accounts/api.js'
import { ConfirmDialog } from './components/confirm-dialog.js'
import {
  decideJoinRequest,
  fetchDepartment,
  fetchInvite,
  fetchJoinRequests,
  fetchMembers,
  putFeatures,
  resetMemberPassword,
  leaveDepartment,
  patchDepartmentSettings,
  removeMember,
  requestDepartmentDeletion,
  rotateJoinKey,
  rotateJoinPassword,
  setJoinApproval,
  setJoinPassword,
  transferHeadship,
  type JoinRequest,
  type Member,
} from './api.js'

type Tab = 'general' | 'invite' | 'members' | 'danger'
const departmentActionKey = (id: string) => ['departments', 'pendingAction', id] as const

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
  const dirty = React.useRef(false)

  React.useEffect(() => {
    if (!isHead) dirty.current = false
    if (deptQuery.data && !dirty.current) {
      setAllowSelfAssign(deptQuery.data.settings.allowSelfAssign)
      setAllowStructureEdit(deptQuery.data.settings.allowStructureEdit)
      setTelegramPerm(deptQuery.data.settings.whoCanConnectTelegramGroup)
    }
  }, [deptQuery.data, isHead])

  const save = useMutation({
    mutationFn: (settings: {
      allowSelfAssign: boolean
      allowStructureEdit: boolean
      whoCanConnectTelegramGroup: 'everyone' | 'head'
    }) => patchDepartmentSettings(id, settings, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      dirty.current = false
      toast(t('departments.settings.saved'))
      void queryClient.invalidateQueries({
        queryKey: ['departments', 'detail', id],
      })
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
        action={{
          labelKey: 'state.error.action',
          onAction: () => deptQuery.refetch(),
        }}
        compact
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* v1.1 critique SEV2 #17: `/department` is the second deliberate own-data exception -- a
          member sees their own department's settings rather than a locked door, because they have to
          know whether self-assign is on. What was missing was the sentence saying so, in the same
          shape `/work/workload` uses for the same reason. */}
      {!isHead ? (
        <ReadOnlyStrip icon={<Lock aria-hidden="true" className="size-4 shrink-0" />}>
          {t('departments.settings.readOnlyNotice')}
        </ReadOnlyStrip>
      ) : null}
      {/* v1.1 critique SEV2 #16. A xodim was shown this card with the imperative "Aʼzolar nimani
          oʻzi bajara olishini belgilang" and nothing at all saying the toggles were read-only --
          while the Imkoniyatlar card directly below it did exactly the right thing ("Ularni boʻlim
          boshligʻi boshqaradi"). Same treatment now: a statement rather than an instruction, and the
          same "your head manages these" caption. */}
      <SectionCard
        title={t('departments.settings.permissionsTitle')}
        description={
          isHead
            ? t('departments.settings.permissionsDescription')
            : t('departments.settings.permissionsReadOnlyDescription')
        }
        actions={
          isHead ? (
            <Button
              size="sm"
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  allowSelfAssign,
                  allowStructureEdit,
                  whoCanConnectTelegramGroup: telegramPerm,
                })
              }
            >
              {t('departments.settings.save')}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-5">
          {save.isError ? (
            <p role="alert" className="text-small text-destructive">
              {t('toast.saveError')}
            </p>
          ) : null}
          <label className="flex items-center justify-between gap-4">
            <span className="text-body text-foreground">
              {t('departments.settings.allowSelfAssign')}
            </span>
            <Switch
              checked={allowSelfAssign}
              disabled={!isHead || save.isPending}
              onCheckedChange={(value) => {
                dirty.current = true
                setAllowSelfAssign(value)
              }}
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-body text-foreground">
              {t('departments.settings.allowStructureEdit')}
            </span>
            <Switch
              checked={allowStructureEdit}
              disabled={!isHead || save.isPending}
              onCheckedChange={(value) => {
                dirty.current = true
                setAllowStructureEdit(value)
              }}
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-small text-foreground">
              {t('departments.settings.telegramGroupLabel')}
            </span>
            <RadioGroup
              value={telegramPerm}
              onValueChange={(v) => {
                dirty.current = true
                setTelegramPerm(v as typeof telegramPerm)
              }}
            >
              <RadioOption
                value="everyone"
                label={t('departments.settings.telegramEveryone')}
                disabled={!isHead || save.isPending}
              />
              <RadioOption
                value="head"
                label={t('departments.settings.telegramHeadOnly')}
                disabled={!isHead || save.isPending}
              />
            </RadioGroup>
          </div>
        </div>
      </SectionCard>
      <div id="features">
        <FeaturesCard id={id} isHead={isHead} features={deptQuery.data.settings.features} />
      </div>
    </div>
  )
}

function InviteTab({ id }: { id: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const pendingCount = useIsMutating({ mutationKey: departmentActionKey(id) })
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
    mutationKey: departmentActionKey(id),
    mutationFn: () => rotateJoinKey(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      setConfirmRotate(null)
      void invalidate()
    },
  })
  const rotatePassword = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: () => rotateJoinPassword(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: (result) => {
      setRevealedPassword(result.password)
      setConfirmRotate(null)
      void invalidate()
    },
  })
  const setPassword = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: () => setJoinPassword(id, customPassword, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      setRevealedPassword(customPassword)
      setCustomPassword('')
      void invalidate()
    },
  })
  const toggleApproval = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: (value: boolean) => setJoinApproval(id, value, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => invalidate(),
  })
  const invitePending =
    rotateKey.isPending ||
    rotatePassword.isPending ||
    setPassword.isPending ||
    toggleApproval.isPending ||
    pendingCount > 0

  if (inviteQuery.isPending) return <StateView kind="loading" titleKey="state.loading" compact />
  if (inviteQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => inviteQuery.refetch(),
        }}
        compact
      />
    )
  }

  const invite = inviteQuery.data
  // round2 critique #29: the server's own configured public origin, not this tab's
  // `window.location.origin` -- see `inviteViewSchema`'s own comment.
  const link = invite.joinKey ? invite.joinUrl : null

  function copyInviteText() {
    if (!link || !revealedPassword) return
    const text = t('departments.invite.inviteText', {
      link,
      password: revealedPassword,
    })
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(t('departments.invite.copiedInvite')))
      .catch(() => toast.error(t('toast.saveError')))
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionCard
        title={t('departments.invite.title')}
        description={t('departments.invite.linkDescription')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={invitePending}
            onClick={() => {
              rotateKey.reset()
              setConfirmRotate('key')
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('departments.invite.rotateKey')}
          </Button>
        }
      >
        {link ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t('departments.invite.title')}
                  readOnly
                  value={link}
                  className="min-w-0 flex-1 font-mono text-small"
                />
                <IconButton
                  aria-label={t('departments.invite.copyLink')}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => toast(t('departments.invite.copiedLink')))
                      .catch(() => toast.error(t('toast.saveError')))
                  }}
                >
                  <Copy className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <span className="text-caption text-muted-foreground">
                {t('departments.invite.keyLabel')}
              </span>
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t('departments.invite.keyLabel')}
                  readOnly
                  value={invite.joinKey ?? ''}
                  className="min-w-0 flex-1 font-mono text-small"
                />
                <IconButton
                  aria-label={t('departments.invite.copyKey')}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(invite.joinKey ?? '')
                      .then(() => toast(t('departments.invite.copiedKey')))
                      .catch(() => toast.error(t('toast.saveError')))
                  }}
                >
                  <Copy className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <label className="flex items-center justify-between gap-4 pt-1">
                <span className="text-small text-foreground">
                  {t('departments.invite.approvalToggleLabel')}
                </span>
                <Switch
                  checked={invite.joinRequiresApproval}
                  disabled={invitePending}
                  onCheckedChange={(v) => toggleApproval.mutate(v)}
                />
              </label>
              <p className="text-caption text-muted-foreground">
                {t('departments.invite.approvalToggleBody')}
              </p>
              {toggleApproval.isError ? (
                <p role="alert" className="text-small text-destructive">
                  {t('toast.saveError')}
                </p>
              ) : null}
            </div>
            {/* Fixed black-on-white, never theme tokens: a QR scanner needs the highest contrast the
                camera can find, not the current colour scheme. */}
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <div className="rounded-md border border-border bg-white p-3">
                <QRCodeSVG
                  role="img"
                  aria-label={t('departments.invite.qrLabel')}
                  value={link}
                  size={128}
                  fgColor="#000000"
                  bgColor="#ffffff"
                />
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
          <Button
            variant="secondary"
            size="sm"
            disabled={invitePending}
            onClick={() => {
              rotatePassword.reset()
              setConfirmRotate('password')
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('departments.invite.rotatePassword')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {setPassword.isError ? (
            <p role="alert" className="text-small text-destructive">
              {t('toast.saveError')}
            </p>
          ) : null}
          {revealedPassword ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t('departments.invite.passwordLabel')}
                  readOnly
                  value={revealedPassword}
                  className="font-mono text-small"
                />
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
                autoComplete="new-password"
                maxLength={128}
                minLength={8}
                aria-describedby="department-invite-password-help"
                disabled={invitePending}
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={customPassword.length < 8 || invitePending}
              loading={setPassword.isPending}
              onClick={() => setPassword.mutate()}
            >
              {t('departments.invite.setPasswordSubmit')}
            </Button>
          </div>
          <p id="department-invite-password-help" className="text-caption text-muted-foreground">
            {t('departments.invite.passwordRequirements')}
          </p>
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
        error={
          (confirmRotate === 'key' ? rotateKey.isError : rotatePassword.isError)
            ? t('toast.saveError')
            : undefined
        }
        onConfirm={() => (confirmRotate === 'key' ? rotateKey.mutate() : rotatePassword.mutate())}
      />
    </div>
  )
}

/**
 * SPEC §2.2 -- the join-approval queue, on the Members tab where a head already goes to think about
 * people. Head-only: both the list and the decision are `{kind:'department_managed'}` server-side, so
 * a member never renders this at all.
 *
 * Undo, not confirm (DESIGN.md): approving or rejecting happens on one click and the toast carries
 * "Bekor qilish", which calls the `undo` route and puts the request back in the queue. That is the
 * right shape for a decision a head makes a dozen times a week and occasionally mis-clicks.
 */
function JoinRequestsCard({ id }: { id: string }) {
  const t = useT()
  const locale = useLocale()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const pendingCount = useIsMutating({ mutationKey: departmentActionKey(id) })
  const query = useQuery({
    queryKey: ['departments', 'joinRequests', id],
    queryFn: () => fetchJoinRequests(id),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['departments', 'joinRequests', id],
    })
    void queryClient.invalidateQueries({
      queryKey: ['departments', 'members', id],
    })
  }

  // Approving somebody into the boshqarma is the moment a person joins a team -- the one decision on
  // this screen worth marking. Rejection and undo get the toast alone: nothing is celebrated about
  // saying no.
  const [approvedUserId, setApprovedUserId] = React.useState<string | null>(null)

  const decide = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: (input: {
      userId: string
      decision: 'approve' | 'reject' | 'undo'
      expectedVersion: number
      originalDecision?: 'approve' | 'reject'
    }) =>
      decideJoinRequest(id, input.userId, input.decision, meQuery.data?.csrfToken ?? '', {
        expectedVersion: input.expectedVersion,
        ...(input.originalDecision ? { originalDecision: input.originalDecision } : {}),
      }),
    onSuccess: (_result, input) => {
      if (input.decision === 'approve') setApprovedUserId(input.userId)
      invalidate()
      if (input.decision === 'undo') {
        toast(t('departments.joinRequests.undone'))
        return
      }
      const originalDecision = input.decision
      toast(
        t(
          input.decision === 'approve'
            ? 'departments.joinRequests.approvedToast'
            : 'departments.joinRequests.rejectedToast',
        ),
        {
          action: {
            label: t('departments.common.undo'),
            onClick: (event) => {
              if (
                !submitDecision({
                  userId: input.userId,
                  decision: 'undo',
                  expectedVersion: input.expectedVersion + 1,
                  originalDecision,
                })
              )
                event.preventDefault()
            },
          },
        },
      )
    },
    onError: (error) => {
      toast.error(
        t(
          error instanceof ApiError && error.status === 409
            ? 'departments.joinRequests.conflict'
            : 'toast.saveError',
        ),
      )
      if (error instanceof ApiError && error.status === 409) invalidate()
    },
  })

  function submitDecision(input: Parameters<typeof decide.mutate>[0]) {
    if (queryClient.isMutating({ mutationKey: departmentActionKey(id) })) {
      toast(t('departments.common.waitForAction'))
      return false
    }
    decide.mutate(input)
    return true
  }

  if (query.isPending) {
    return (
      <SectionCard title={t('departments.joinRequests.title')}>
        <StateView kind="loading" titleKey="state.loading" compact />
      </SectionCard>
    )
  }
  if (query.isError) {
    return (
      <SectionCard title={t('departments.joinRequests.title')}>
        <StateView
          kind="error"
          titleKey="state.error.title"
          bodyKey="state.error.body"
          action={{
            labelKey: 'state.error.action',
            onAction: () => query.refetch(),
          }}
          compact
        />
      </SectionCard>
    )
  }

  const requests = query.data.requests
  return (
    <SectionCard
      // The count belongs next to the heading, not in `actions` -- `SectionCard` renders `actions`
      // as a footer row (that is where "Saqlash" sits on the card above), so a badge there reads as
      // a stray control at the bottom of the card rather than "one person is waiting".
      title={
        requests.length > 0
          ? `${t('departments.joinRequests.title')} · ${requests.length}`
          : t('departments.joinRequests.title')
      }
      description={t('departments.joinRequests.description')}
    >
      {requests.length === 0 ? (
        <StateView
          kind="empty"
          titleKey="departments.joinRequests.empty.title"
          bodyKey="departments.joinRequests.empty.body"
          compact
        />
      ) : (
        <Reveal>
          <DataList label={t('departments.joinRequests.title')}>
            {requests.map((r: JoinRequest) => {
              const name = `${r.givenName} ${r.familyName}`
              return (
                <DataRow
                  key={r.userId}
                  leading={
                    <Avatar
                      size="sm"
                      alt={name}
                      decorative
                      initials={initialsFromName(r.givenName, r.familyName)}
                      hueSeed={r.userId}
                    />
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pendingCount > 0}
                        onClick={() =>
                          submitDecision({
                            userId: r.userId,
                            decision: 'reject',
                            expectedVersion: r.version,
                          })
                        }
                      >
                        {t('departments.joinRequests.reject')}
                      </Button>
                      <span className="relative inline-flex">
                        <Button
                          size="sm"
                          disabled={pendingCount > 0}
                          onClick={() =>
                            submitDecision({
                              userId: r.userId,
                              decision: 'approve',
                              expectedVersion: r.version,
                            })
                          }
                        >
                          {t('departments.joinRequests.approve')}
                        </Button>
                        <Celebrate
                          play={approvedUserId === r.userId}
                          onDone={() => setApprovedUserId(null)}
                        />
                      </span>
                    </div>
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-body text-foreground">
                      {name}
                      {r.title ? <span className="text-muted-foreground"> · {r.title}</span> : null}
                    </p>
                    <span className="text-small text-muted-foreground">
                      {t('departments.joinRequests.requestedAt', {
                        date: formatDate(new Date(r.requestedAt), locale),
                      })}
                    </span>
                  </div>
                </DataRow>
              )
            })}
          </DataList>
        </Reveal>
      )}
    </SectionCard>
  )
}

/**
 * SPEC §7 -- Imkoniyatlar. The head flips them; a member sees the same list, read-only, because
 * "we do not use estimates in this boshqarma" is a fact worth being able to look up rather than
 * infer from an absence.
 *
 * Saved per switch, immediately, with an undo in the toast -- a settings screen with eleven toggles
 * and one Save button is how people lose changes.
 */
function FeaturesCard({
  id,
  isHead,
  features,
}: {
  id: string
  isHead: boolean
  features: Record<string, boolean>
}) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: (patch: Partial<Record<FeatureKey, boolean>>) =>
      putFeatures(id, patch, meQuery.data?.csrfToken ?? ''),
    onSuccess: (_result, patch) => {
      void queryClient.invalidateQueries({
        queryKey: ['departments', 'detail', id],
      })
      const [key, value] = Object.entries(patch)[0] ?? []
      if (!key) return
      toast(t(value ? 'departments.features.onToast' : 'departments.features.offToast'), {
        action: {
          label: t('departments.common.undo'),
          onClick: () => save.mutate({ [key as FeatureKey]: !value }),
        },
      })
    },
    onError: () => toast.error(t('toast.saveError')),
  })

  return (
    <SectionCard
      title={t('departments.features.title')}
      description={t(
        isHead ? 'departments.features.description' : 'departments.features.readOnlyDescription',
      )}
    >
      <div className="flex flex-col gap-5">
        {FEATURE_KEYS.map((key) => (
          // Not a <label>: the Switch primitive renders a button with role=switch, which a label
          // cannot be associated with. aria-label + aria-describedby is what actually reaches a
          // screen reader here -- the switch announces its own name and the sentence under it.
          <div key={key} className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body text-foreground">{t(FEATURES[key].labelKey)}</span>
              <span
                id={`feature-${key}-description`}
                className="text-caption text-muted-foreground"
              >
                {t(FEATURES[key].descriptionKey)}
              </span>
            </div>
            <Switch
              aria-label={t(FEATURES[key].labelKey)}
              aria-describedby={`feature-${key}-description`}
              checked={features[key] ?? false}
              disabled={!isHead || save.isPending}
              onCheckedChange={(value) => save.mutate({ [key]: value })}
            />
          </div>
        ))}
      </div>
    </SectionCard>
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
  actionPending,
}: {
  member: Member
  isHead: boolean
  isSuperAdmin: boolean
  myUserId: string
  onTransfer: () => void
  onRemove: () => void
  onLeave: () => void
  onResetPassword: () => void
  actionPending: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const name = `${member.givenName} ${member.familyName}`
  const isMe = member.userId === myUserId
  // v1.1 SPEC §2.2: a head may now reset an ordinary member's password (the department-scoped route);
  // a super admin may reset anyone's (the instance route). Resetting another *head*'s password is
  // refused by the server, so the item is not offered either.
  const canResetAsHead = isHead && !isMe && member.role !== 'head' && member.status === 'active'
  const hasMenu = (isHead && !isMe) || (isSuperAdmin && !isMe)

  return (
    <DataRow
      leading={
        <Avatar
          size="sm"
          alt={name}
          // SEV2 #21: the row prints the name immediately below.
          decorative
          initials={initialsFromName(member.givenName, member.familyName)}
          hueSeed={member.userId}
        />
      }
      trailing={
        <>
          {isMe ? (
            <Button size="sm" variant="ghost" disabled={actionPending} onClick={onLeave}>
              {t('departments.members.leave')}
            </Button>
          ) : null}
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* SEV2 #21: every one of the 26 row menus carried the accessible name
                    "Aʼzolar" -- the section heading -- so a screen-reader user could not tell whose
                    menu they were about to open. Named after its member, the same pattern the
                    people table already gets right ("Nodira Karimovaga vazifa berish"). */}
                <IconButton
                  aria-label={t('departments.members.rowMenuAria', { name })}
                  disabled={actionPending}
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isHead && !isMe ? (
                  <>
                    <DropdownMenuItem disabled={actionPending} onSelect={onTransfer}>
                      {t('departments.members.transfer')}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={actionPending} onSelect={onRemove}>
                      {t('departments.members.remove')}
                    </DropdownMenuItem>
                  </>
                ) : null}
                {(isSuperAdmin && !isMe) || canResetAsHead ? (
                  <DropdownMenuItem disabled={actionPending} onSelect={onResetPassword}>
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
            date: formatDate(new Date(member.joinedAt), locale),
          })}
        </span>
      </div>
    </DataRow>
  )
}

type MemberAction = {
  kind: 'transfer' | 'remove' | 'leave' | 'resetPassword'
  member?: Member
}

function MembersTab({ id, isHead, myUserId }: { id: string; isHead: boolean; myUserId: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const pendingCount = useIsMutating({ mutationKey: departmentActionKey(id) })
  const membersQuery = useQuery({
    queryKey: ['departments', 'members', id],
    queryFn: () => fetchMembers(id),
  })
  const isSuperAdmin = meQuery.data?.user.role === 'super_admin'
  const [tempPassword, setTempPassword] = React.useState<string | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<MemberAction | null>(null)
  // Capture the selected operation before transport starts. Closing its dialog must not
  // retarget a pending write or let its late response dismiss a different confirmation.
  const pendingAction = React.useRef<MemberAction | null>(null)
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const closeCompletedAction = (action: MemberAction) => {
    if (mounted.current) setConfirmAction((current) => (current === action ? null : current))
  }
  const settleAction = (_data: unknown, _error: unknown, action: MemberAction) => {
    if (pendingAction.current === action) pendingAction.current = null
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['departments', 'members', id],
    })
    void queryClient.invalidateQueries({ queryKey: ['departments', 'mine'] })
    void queryClient.invalidateQueries({ queryKey: ['departments', 'detail', id] })
    void queryClient.invalidateQueries({ queryKey: ['me'] })
  }
  const remove = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: (action: MemberAction) =>
      removeMember(id, action.member!.userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: (_result, action) => {
      toast(t('departments.members.removedToast'))
      closeCompletedAction(action)
      invalidate()
    },
    onSettled: settleAction,
  })
  const transfer = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: (action: MemberAction) =>
      transferHeadship(id, action.member!.userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: (_result, action) => {
      toast(t('departments.members.transferredToast'))
      closeCompletedAction(action)
      invalidate()
    },
    onSettled: settleAction,
  })
  const leave = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: (_action: MemberAction) => leaveDepartment(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: (_result, action) => {
      toast(t('departments.members.leftToast'))
      closeCompletedAction(action)
      invalidate()
      if (mounted.current && pendingAction.current === action) navigate('/departments')
    },
    onError: (error) =>
      toast.error(
        t(
          error instanceof ApiError && error.status === 409
            ? 'departments.members.leaveBlockedHead'
            : 'toast.saveError',
        ),
      ),
    onSettled: settleAction,
  })
  // Two different routes behind one menu item, picked by who is asking (v1.1 SPEC §2.2):
  //  - a **head** resets an ordinary member of their own department
  //    (`POST /departments/:id/members/:userId/reset-password`, `{kind:'department_managed'}`);
  //  - a **super admin** resets anyone (`POST /accounts/:userId/reset-password`,
  //    `{kind:'instance'}`) -- the pre-v1.1 behaviour, unchanged.
  // Before v1.1 only the second existed, so every forgotten password in every department escalated
  // to the single ministry super admin (WALKTHROUGH-FINDINGS §2.5).
  const resetPassword = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: (action: MemberAction) =>
      isHead
        ? resetMemberPassword(id, action.member!.userId, meQuery.data?.csrfToken ?? '')
        : adminResetPassword(action.member!.userId, meQuery.data?.csrfToken ?? ''),
    onSuccess: (result, action) => {
      toast(t('accounts.admin.resetPassword.success'))
      closeCompletedAction(action)
      // The returned password is shown once even if its pending confirmation was closed.
      if (mounted.current) setTempPassword(result.temporaryPassword)
    },
    onSettled: settleAction,
  })
  const actionPending =
    transfer.isPending ||
    remove.isPending ||
    leave.isPending ||
    resetPassword.isPending ||
    pendingCount > 0

  function openAction(action: MemberAction) {
    if (pendingAction.current || queryClient.isMutating({ mutationKey: departmentActionKey(id) }))
      return
    if (action.kind === 'transfer') transfer.reset()
    else if (action.kind === 'remove') remove.reset()
    else if (action.kind === 'resetPassword') resetPassword.reset()
    else leave.reset()
    setConfirmAction(action)
  }

  if (membersQuery.isPending) return <StateView kind="loading" titleKey="state.loading" compact />
  if (membersQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => membersQuery.refetch(),
        }}
        compact
      />
    )
  }

  // Removed memberships remain in the API for history, but are no longer people in this team.
  const members = membersQuery.data.members.filter((member) => member.status !== 'removed')

  return (
    <div className="flex flex-col gap-4">
      {isHead ? <JoinRequestsCard id={id} /> : null}
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
                actionPending={actionPending}
                onTransfer={() => openAction({ kind: 'transfer', member: m })}
                onRemove={() => openAction({ kind: 'remove', member: m })}
                onLeave={() => openAction({ kind: 'leave' })}
                onResetPassword={() => openAction({ kind: 'resetPassword', member: m })}
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
        loading={actionPending}
        error={
          (
            confirmAction?.kind === 'transfer'
              ? transfer.isError
              : confirmAction?.kind === 'remove'
                ? remove.isError
                : confirmAction?.kind === 'resetPassword'
                  ? resetPassword.isError
                  : leave.isError
          )
            ? t('toast.saveError')
            : undefined
        }
        onConfirm={() => {
          if (
            !confirmAction ||
            pendingAction.current ||
            queryClient.isMutating({ mutationKey: departmentActionKey(id) })
          )
            return
          pendingAction.current = confirmAction
          if (confirmAction.kind === 'transfer' && confirmAction.member)
            transfer.mutate(confirmAction)
          else if (confirmAction.kind === 'remove' && confirmAction.member)
            remove.mutate(confirmAction)
          else if (confirmAction.kind === 'resetPassword' && confirmAction.member)
            resetPassword.mutate(confirmAction)
          else if (confirmAction.kind === 'leave') leave.mutate(confirmAction)
          else pendingAction.current = null
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
          try {
            if (tempPassword) await navigator.clipboard.writeText(tempPassword)
            toast(t('accounts.admin.resetPassword.copied'))
            setTempPassword(null)
          } catch {
            toast.error(t('toast.saveError'))
          }
        }}
      />
    </div>
  )
}

function DangerTab({ id, departmentName }: { id: string; departmentName: string }) {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const pendingCount = useIsMutating({ mutationKey: departmentActionKey(id) })
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const request = useMutation({
    mutationKey: departmentActionKey(id),
    mutationFn: () => requestDepartmentDeletion(id, meQuery.data?.csrfToken ?? ''),
    onSuccess: () => {
      toast(t('departments.settings.deletionRequested'))
      setConfirmOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['departments', 'detail', id] })
      void queryClient.invalidateQueries({ queryKey: ['departments', 'mine'] })
    },
  })
  return (
    <SectionCard
      title={t('departments.settings.dangerZone')}
      description={t('departments.settings.dangerZoneDescription')}
      className="border-destructive/40"
    >
      <Button
        variant="destructive"
        size="sm"
        disabled={request.isPending || pendingCount > 0}
        onClick={() => {
          request.reset()
          setConfirmOpen(true)
        }}
      >
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
        error={request.isError ? t('toast.saveError') : undefined}
        onConfirm={() => request.mutate()}
        typedConfirmValue={departmentName}
        typedConfirmLabel={t('departments.settings.typedConfirmLabel', {
          name: departmentName,
        })}
      />
    </SectionCard>
  )
}

export default function DepartmentDetailScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const params = useSearchParams()
  const { departmentId, memberships } = useDepartment()
  // WALKTHROUGH-FINDINGS §2.4: `/department` with no `?id` used to render a generic "could not load"
  // error -- with no network request behind it -- which is exactly where the sidebar's own
  // "Boʻlimlar" entry and the hub's "Sozlamalarni ochish" link both landed. Without an id the screen
  // is simply about *your* department, which the session already knows.
  const id = params.get('id') ?? departmentId ?? ''
  // `?tab=` is honoured so a deep link can land on the right tab -- the join-request notification
  // points at `?tab=members`, and a link that opened the wrong tab would be worse than no link.
  const requestedTab = params.get('tab')
  const [tab, setTab] = React.useState<Tab>(
    requestedTab === 'invite' ||
      requestedTab === 'members' ||
      requestedTab === 'danger' ||
      requestedTab === 'general'
      ? requestedTab
      : 'general',
  )

  const deptQuery = useQuery({
    queryKey: ['departments', 'detail', id],
    queryFn: () => fetchDepartment(id),
    enabled: id.length > 0,
  })

  // Only reachable for an account that belongs to no department at all -- an empty state that
  // teaches the next action, not an error (DESIGN.md).
  if (!id) {
    return (
      <StateView
        kind="empty"
        titleKey="departments.detail.noDepartment.title"
        bodyKey="departments.detail.noDepartment.body"
        action={{
          labelKey: 'departments.detail.noDepartment.action',
          onAction: () => navigate('/departments'),
        }}
      />
    )
  }
  void memberships
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
        action={{
          labelKey: 'state.error.action',
          onAction: () => deptQuery.refetch(),
        }}
      />
    )
  }

  const dept = deptQuery.data
  const isHead = dept.myRole === 'head'
  const myUserId = meQuery.data?.user.id ?? ''

  return (
    <Tabs
      value={!isHead && (tab === 'invite' || tab === 'danger') ? 'general' : tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="flex flex-col gap-6"
    >
      <PageHeader
        eyebrow={t('departments.title')}
        title={`${dept.emoji ? `${dept.emoji} ` : ''}${dept.name}`}
        tabs={
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
        }
      />

      <TabsContent value="general">
        <GeneralTab key={id} id={id} isHead={isHead} />
      </TabsContent>
      {isHead ? (
        <TabsContent value="invite">
          <InviteTab key={id} id={id} />
        </TabsContent>
      ) : null}
      <TabsContent value="members">
        <MembersTab key={id} id={id} isHead={isHead} myUserId={myUserId} />
      </TabsContent>
      {isHead ? (
        <TabsContent value="danger">
          <DangerTab key={id} id={id} departmentName={dept.name} />
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
