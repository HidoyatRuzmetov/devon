// `/departments` -- the fresh-account landing ("Create a department or join one", TECH-SPEC §2.1)
// when the signed-in user has no membership yet, and the department switcher/hub once they do.
// Rebuilt to UI-OVERHAUL.md's Jakob row "Departments hub / join" (Slack workspaces, Discord invite):
// create-or-join as two big illustrated cards, the ambient gradient hub treatment (DESIGN.md v2 §2.6
// -- allowed here because this is a hub screen, never behind a working board or a form), a returning
// applicant sees their request's status timeline instead of the cards again, and a member sees their
// current department's facts (name, head, member count, role), the head's invite block (link, QR,
// password) right on the hub, and a switcher for any other membership.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  Copy,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  CreateDepartmentIllustration,
  HoverLift,
  HubAmbientWash,
  IconButton,
  Input,
  JoinDepartmentIllustration,
  PageHeader,
  Reveal,
  SectionCard,
  Sheet,
  SheetContent,
  Skeleton,
  Stagger,
  StaggerItem,
  StateView,
  cardVariants,
  cn,
  initialsFromName,
  toast,
  useReducedMotion,
} from '@devon/ui'
import { avatarUrl } from '../../lib/avatar.js'
import { useSession, useDepartment, useMeQuery } from '../../lib/session.js'
import { navigate } from '../../lib/router.js'
import {
  fetchInvite,
  fetchMembers,
  fetchMyDepartments,
  fetchMyRequests,
  rotateJoinPassword,
} from './api.js'
import { PendingRequestView } from './components/pending-request-view.js'

function ChoiceCard({
  illustration,
  titleKey,
  bodyKey,
  ctaKey,
  onClick,
}: {
  illustration: React.ReactNode
  titleKey: string
  bodyKey: string
  ctaKey: string
  onClick: () => void
}) {
  const t = useT()
  return (
    <HoverLift className="h-full rounded-md">
      <button
        type="button"
        onClick={onClick}
        className="flex h-full w-full flex-col items-start gap-4 rounded-md border border-border bg-card p-6 text-left shadow-1 transition-colors duration-(--dur-micro) hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {illustration}
        <div className="flex flex-col gap-1.5">
          <h2 className="text-h3 text-foreground">{t(titleKey)}</h2>
          <p className="text-body text-muted-foreground">{t(bodyKey)}</p>
        </div>
        <span className="mt-auto inline-flex items-center gap-1.5 text-body font-medium text-primary">
          {t(ctaKey)}
          <ArrowRight className="size-4" aria-hidden="true" />
        </span>
      </button>
    </HoverLift>
  )
}

/** A label above a value -- the four facts the current-department card leads with (name is the card's
 * own title; head, member count and role are these). */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 text-body font-medium text-foreground">{children}</span>
    </div>
  )
}

/** The head's invite block, embedded directly on the hub (UI-OVERHAUL.md's Jakob row: "invite link
 * with copy + QR") -- link, a real QR, and the join password with show/regenerate. Regenerating the
 * password breaks it for anyone who still has the old one, so that action sits behind a bottom sheet
 * that says exactly that, rather than firing on a single click. */
function InviteBlock({ departmentId }: { departmentId: string }) {
  const t = useT()
  const reduced = useReducedMotion()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const inviteQuery = useQuery({
    queryKey: ['departments', 'invite', departmentId],
    queryFn: () => fetchInvite(departmentId),
  })
  const [revealedPassword, setRevealedPassword] = React.useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  // round2 SEV3 "copying the invite gives no inline confirmation animation (only a toast)": the
  // button itself morphs its icon to a check for a beat, the same "acted on, here is proof" shape
  // `Button`'s own `success` prop gives a text button -- there is no icon-button equivalent, so this
  // is done by hand for the one icon-only copy action in the product that needs it.
  const [justCopied, setJustCopied] = React.useState(false)

  const rotatePassword = useMutation({
    mutationFn: () => rotateJoinPassword(departmentId, meQuery.data?.csrfToken ?? ''),
    onSuccess: (result) => {
      setRevealedPassword(result.password)
      setConfirmOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['departments', 'invite', departmentId] })
    },
  })

  if (inviteQuery.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }
  if (inviteQuery.isError || !inviteQuery.data.joinKey || !inviteQuery.data.joinUrl) return null

  // round2 critique #29: the server's own configured public origin (`DEVON_PUBLIC_URL`), not this
  // tab's `window.location.origin` -- see `inviteViewSchema`'s own comment.
  const link = inviteQuery.data.joinUrl

  function copyInvitation() {
    const text = revealedPassword
      ? t('departments.invite.inviteText', { link, password: revealedPassword })
      : link
    void navigator.clipboard.writeText(text).then(() => {
      toast(
        t(revealedPassword ? 'departments.invite.copiedInvite' : 'departments.invite.copiedLink'),
      )
      setJustCopied(true)
      window.setTimeout(() => setJustCopied(false), 1400)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {t('departments.invite.title')}
      </span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-1 flex-col gap-2">
          {/* round2 SEV3 #29: the copy action used to be a full-width button sitting below the
              field -- now an inline icon button next to it, the same recipe the sentinel key field
              uses. */}
          <div className="flex items-center gap-2">
            <Input readOnly value={link} className="min-w-0 flex-1 font-mono text-small" />
            <IconButton
              aria-label={t('departments.invite.copyInvite')}
              onClick={copyInvitation}
              className="overflow-hidden"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {justCopied ? (
                  <motion.span
                    key="copied"
                    className="inline-flex text-success"
                    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0.1 : 0.18 }}
                  >
                    <Check className="size-4" aria-hidden="true" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="copy"
                    className="inline-flex"
                    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0.1 : 0.18 }}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                  </motion.span>
                )}
              </AnimatePresence>
            </IconButton>
          </div>
        </div>
        {/* Fixed black-on-white, never theme tokens: a QR scanner needs the highest contrast the
            camera can find, not the current colour scheme. round2 SEV3 "the QR does not fade in". */}
        <Reveal className="flex shrink-0 flex-col items-center gap-1.5">
          <div className="rounded-md border border-border bg-white p-3">
            <QRCodeSVG value={link} size={112} fgColor="#000000" bgColor="#ffffff" />
          </div>
          <span className="text-caption text-muted-foreground">
            {t('departments.invite.qrLabel')}
          </span>
        </Reveal>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-small text-foreground">
            {t('departments.invite.passwordLabel')}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('departments.invite.rotatePassword')}
          </Button>
        </div>
        {revealedPassword ? (
          <Input readOnly value={revealedPassword} className="font-mono text-small" />
        ) : (
          <p className="text-caption text-muted-foreground">
            {t('departments.invite.passwordHiddenNotice')}
          </p>
        )}
      </div>

      <Sheet direction="bottom" open={confirmOpen} onOpenChange={setConfirmOpen}>
        <SheetContent
          side="bottom"
          title={t('departments.invite.rotatePasswordDialogTitle')}
          className="flex flex-col gap-4 p-5"
        >
          <h2 className="text-h3 text-foreground">
            {t('departments.invite.rotatePasswordDialogTitle')}
          </h2>
          <p className="text-body text-muted-foreground">
            {t('departments.invite.rotatePasswordConfirm')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('departments.common.cancel')}
            </Button>
            <Button loading={rotatePassword.isPending} onClick={() => rotatePassword.mutate()}>
              {t('departments.invite.rotatePassword')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** The signed-in member's own department: name, head, member count and role, plus (for the head) the
 * invite block right here -- UI-OVERHAUL.md's Jakob row "Departments hub / join". */
function CurrentDepartmentCard({
  department,
}: {
  department: {
    id: string
    name: string
    emoji: string | null
    memberCount: number
    myRole: 'head' | 'member'
  }
}) {
  const t = useT()
  const isHead = department.myRole === 'head'
  const membersQuery = useQuery({
    queryKey: ['departments', 'members', department.id],
    queryFn: () => fetchMembers(department.id),
  })
  const head = membersQuery.data?.members.find((m) => m.role === 'head')

  // A plain if/else (not a JSX ternary chain) so no `>...<` boundary at the branch seam can ever be
  // mistaken for hard-coded text by `check-i18n.mjs`'s regex heuristic -- the same reasoning
  // `structure-screen.tsx`'s own body switch documents for its ternary.
  let headStat: React.ReactNode
  if (membersQuery.isPending) {
    headStat = <Skeleton className="h-5 w-24" />
  } else if (head) {
    headStat = (
      <span className="flex items-center gap-2">
        <Avatar
          src={avatarUrl(head.avatarKey, 64)}
          size="sm"
          alt={`${head.givenName} ${head.familyName}`}
          initials={initialsFromName(head.givenName, head.familyName)}
          hueSeed={head.userId}
        />
        <span className="truncate">{`${head.givenName} ${head.familyName}`}</span>
      </span>
    )
  } else {
    headStat = <span className="text-muted-foreground">{t('departments.hub.noHead')}</span>
  }

  return (
    <SectionCard
      title={`${department.emoji ? `${department.emoji} ` : ''}${department.name}`}
      headerAside={
        <Badge tone={isHead ? 'primary' : 'neutral'} variant={isHead ? 'outline' : 'subtle'}>
          {t(isHead ? 'departments.members.roleHead' : 'departments.members.roleMember')}
        </Badge>
      }
    >
      <div className="flex flex-col gap-6">
        {/* round2 SEV3 #29: the role used to appear twice -- once as the header badge, once as its
            own "SIZNING ROLINGIZ" stat here. The badge already says it; this grid only needs the
            two facts it doesn't carry. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Stat label={t('departments.hub.statHead')}>{headStat}</Stat>
          <Stat label={t('departments.hub.statMembers')}>
            <span className="flex items-center gap-1.5">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              {department.memberCount}
            </span>
          </Stat>
        </div>

        {isHead ? (
          <div className="border-t border-border pt-5">
            <InviteBlock departmentId={department.id} />
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/department?id=${department.id}`)}
          >
            {t('departments.hub.manageLink')}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

export default function DepartmentsHubScreen() {
  const t = useT()
  const session = useSession()
  const { departmentId: activeDepartmentId, setDepartmentId } = useDepartment()
  const query = useQuery({
    queryKey: ['departments', 'mine'],
    queryFn: fetchMyDepartments,
    enabled: session.isAuthenticated,
  })
  const requestsQuery = useQuery({
    queryKey: ['departments', 'requests', 'mine'],
    queryFn: fetchMyRequests,
    enabled: session.isAuthenticated,
  })

  if (
    session.isLoading ||
    (session.isAuthenticated && (query.isPending || requestsQuery.isPending))
  ) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (query.isError || requestsQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => {
            void query.refetch()
            void requestsQuery.refetch()
          },
        }}
      />
    )
  }

  const departments = query.data?.departments ?? []

  if (departments.length === 0) {
    // A returning applicant whose department-creation request is still in flight (or was just
    // approved but this list hasn't caught up yet) sees where it stands, not the create-or-join
    // cards again -- UI-OVERHAUL.md's "pending request state with a friendly illustration". A
    // rejected request falls through to the cards below; `/departments/new` shows its reason and
    // its own working "create another" action.
    const latestRequest = requestsQuery.data?.requests[0]
    if (latestRequest && latestRequest.status !== 'rejected') {
      return (
        <PendingRequestView
          status={latestRequest.status}
          name={latestRequest.name}
          reason={latestRequest.reason}
          onCreateAnother={() => navigate('/departments/new')}
        />
      )
    }

    return (
      <div className="relative flex flex-col gap-8">
        <HubAmbientWash />
        <Reveal className="mx-auto flex max-w-160 flex-col items-center gap-2 pt-8 text-center">
          <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('departments.landing.eyebrow')}
          </p>
          <h1 className="font-display text-h1 text-foreground">{t('departments.landing.title')}</h1>
          <p className="max-w-120 text-lead text-muted-foreground">
            {t('departments.landing.body')}
          </p>
        </Reveal>
        <Stagger className="mx-auto grid w-full max-w-160 grid-cols-1 gap-5 sm:grid-cols-2">
          <StaggerItem className="h-full">
            <ChoiceCard
              illustration={<CreateDepartmentIllustration className="w-32" />}
              titleKey="departments.landing.createTitle"
              bodyKey="departments.landing.createBody"
              ctaKey="departments.landing.createCta"
              onClick={() => navigate('/departments/new')}
            />
          </StaggerItem>
          <StaggerItem className="h-full">
            <ChoiceCard
              illustration={<JoinDepartmentIllustration className="w-32" />}
              titleKey="departments.landing.joinTitle"
              bodyKey="departments.landing.joinBody"
              ctaKey="departments.landing.joinCta"
              onClick={() => navigate('/join')}
            />
          </StaggerItem>
        </Stagger>
      </div>
    )
  }

  const active = departments.find((d) => d.id === activeDepartmentId) ?? departments[0]!
  const others = departments.filter((d) => d.id !== active.id)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t('departments.landing.eyebrow')}
        title={t('departments.title')}
        description={t('departments.subtitle')}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => navigate('/join')}>
              {t('departments.landing.joinCta')}
            </Button>
            <Button size="sm" onClick={() => navigate('/departments/new')}>
              <Plus className="size-4" aria-hidden="true" /> {t('departments.landing.createCta')}
            </Button>
          </>
        }
      />

      {/* round2 SEV3 "switching department does not transition": crossfades to the newly active
          department's card instead of its facts simply swapping in place. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={active.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <CurrentDepartmentCard department={active} />
        </motion.div>
      </AnimatePresence>

      {others.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('departments.hub.otherMemberships')}
          </h2>
          <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {others.map((d) => (
              <StaggerItem key={d.id} className="h-full">
                <HoverLift className="h-full rounded-md">
                  <button
                    type="button"
                    onClick={() => setDepartmentId(d.id)}
                    className={cn(
                      cardVariants(),
                      'flex h-full w-full flex-col gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-body font-medium text-foreground">
                        <Building2
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          {d.emoji ? `${d.emoji} ` : ''}
                          {d.name}
                        </span>
                      </span>
                      <Badge
                        tone={d.myRole === 'head' ? 'primary' : 'neutral'}
                        variant={d.myRole === 'head' ? 'outline' : 'subtle'}
                      >
                        {t(
                          d.myRole === 'head'
                            ? 'departments.members.roleHead'
                            : 'departments.members.roleMember',
                        )}
                      </Badge>
                    </div>
                    <span className="flex items-center gap-1 text-small text-muted-foreground">
                      <Users className="size-3.5" aria-hidden="true" /> {d.memberCount}
                    </span>
                  </button>
                </HoverLift>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      ) : null}
    </div>
  )
}
