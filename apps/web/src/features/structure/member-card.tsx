// A member card (TECH-SPEC EPIC-003: "member cards") -- the People directory's grid card (avatar,
// title) and, `compact`, the org-chart's role rows. A `PersonHoverCard` (avatar, title, unit, "open
// board column") appears on hover/focus (UI-OVERHAUL.md §8 "People directory": Slack-members
// conventions) -- it is the *only* place the card repeats the unit, because the grid always already
// groups by unit (a heading, or the active filter chip): saying it again on every card's face is
// exactly the repeated-null-state the design pass flagged.
import { useT } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Button,
  FilterChip,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  initialsFromName,
  toast,
} from '@devon/ui'
import { KanbanSquare, Link as LinkIcon, Users } from 'lucide-react'
import { avatarUrl } from '../../lib/avatar.js'
import { navigate } from '../../lib/router.js'
import type { Member, Unit } from './api.js'

const ROLE_KEY = {
  head: 'structure.roles.roleLabel.head',
  deputy: 'structure.roles.roleLabel.deputy',
  member: 'structure.roles.roleLabel.member',
} as const

export function fullName(m: Pick<Member, 'givenName' | 'familyName' | 'patronymic'>): string {
  return [m.familyName, m.givenName, m.patronymic].filter(Boolean).join(' ')
}

export function MemberCard({
  member,
  unit,
  compact = false,
  onFilterByUnit,
}: {
  member: Member
  /** The bo'lim this member belongs to, when known -- surfaced only in the hover card's detail, never
   * on the card's own face, because the grid that renders these cards already groups by unit (a
   * heading, or the active filter chip). */
  unit?: Unit | null
  compact?: boolean
  /** ui-blitz round3 #23: every caller of this card already shows the member's bo'lim right next to
   * it (a group heading, or the active filter chip), so a "Boʻlim: X" line inside the hover card
   * repeated a fact the viewer had just read -- a genuine null-state, not new information. Passing
   * this (both real call sites in `people-screen.tsx` do) turns that dead line into a second working
   * action instead: narrow the same grid to this member's unit, in place, no navigation. Omit it (as
   * `structure-screen.tsx`'s compact org-chart rows implicitly do by never rendering the hover card at
   * all) and the card simply has one action, same as before -- never a broken affordance. */
  onFilterByUnit?: ((unitId: string) => void) | undefined
}) {
  const t = useT()
  const body = (
    <div
      className={
        compact
          ? 'flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5'
          : // round2 SEV3.5 "cards have no lift": a plain CSS hover (not the `HoverLift` primitive,
            // which wraps its child in a `motion.div` that would swallow the pointer/focus handlers
            // `HoverCardTrigger asChild` injects onto this exact element) -- transform + shadow only,
            // and `motion-reduce:` (the Tailwind variant for `prefers-reduced-motion: reduce`) drops
            // just the travel, keeping the shadow step as the reduced-motion replacement.
            'flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-1 transition-[transform,box-shadow] duration-(--dur-micro) ease-out hover:-translate-y-0.5 hover:shadow-2 motion-reduce:hover:translate-y-0'
      }
    >
      <div className={compact ? 'contents' : 'flex items-center gap-3'}>
        <Avatar
          src={avatarUrl(member.avatarKey, compact ? 64 : 128)}
          size={compact ? 'sm' : 'lg'}
          alt={fullName(member)}
          initials={initialsFromName(member.givenName, member.familyName)}
          hueSeed={member.unitId ?? member.userId}
        />
        <div className="min-w-0 flex-1">
          <p
            className={
              compact
                ? 'truncate text-small text-foreground'
                : 'truncate text-body font-medium text-foreground'
            }
          >
            {fullName(member)}
          </p>
          {member.title ? (
            <p className="truncate text-caption text-muted-foreground">{member.title}</p>
          ) : null}
        </div>
        {member.unitRole ? (
          <Badge tone={member.unitRole === 'head' ? 'info' : 'neutral'}>
            {t(ROLE_KEY[member.unitRole])}
          </Badge>
        ) : null}
      </div>
    </div>
  )

  if (compact) return body

  // A plain if/else (not a JSX ternary chain) -- same reasoning as `people-screen.tsx`'s own body
  // switch: a `>...<` boundary at a ternary's branch point can be mistaken for hard-coded text by
  // `check-i18n.mjs`'s regex heuristic.
  let unitControl: React.ReactNode
  if (unit && onFilterByUnit) {
    unitControl = (
      <FilterChip
        className="mt-3 w-full justify-between"
        aria-label={t('structure.people.hoverCard.filterByUnitAria', { unit: unit.name })}
        onClick={() => onFilterByUnit(unit.id)}
      >
        <Users className="size-3.5 shrink-0" aria-hidden="true" />
        {unit.name}
      </FilterChip>
    )
  } else if (!unit) {
    unitControl = (
      <p className="mt-3 text-small text-muted-foreground">
        {t('structure.people.memberCard.noUnit')}
      </p>
    )
  } else {
    unitControl = null
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{body}</HoverCardTrigger>
      <HoverCardContent className="w-72">
        <div className="flex items-center gap-3">
          <Avatar
            src={avatarUrl(member.avatarKey, 128)}
            size="lg"
            alt={fullName(member)}
            initials={initialsFromName(member.givenName, member.familyName)}
            hueSeed={member.unitId ?? member.userId}
          />
          <div className="min-w-0">
            <p className="truncate text-body font-medium text-foreground">{fullName(member)}</p>
            {member.title ? (
              <p className="truncate text-small text-muted-foreground">{member.title}</p>
            ) : null}
          </div>
        </div>
        {/* ui-blitz round3 #23: an eyebrow + a real control, not a second "label: value" prose line
            -- `membership` is genuinely new information (the *department*-level role; the card's
            face, above, only ever shows the *unit*-level one), so it stays as a fact. The unit is
            not a fact worth restating (every caller already shows it beside the card) -- when the
            caller can act on it (`onFilterByUnit`), it becomes the interactive control that replaces
            the dead line entirely; otherwise it is omitted rather than repeated. */}
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('structure.people.hoverCard.membership')}
          </p>
          <Badge tone={member.membershipRole === 'head' ? 'info' : 'neutral'} className="w-fit">
            {t(
              member.membershipRole === 'head'
                ? 'departments.members.roleHead'
                : 'departments.members.roleMember',
            )}
          </Badge>
        </div>
        {unitControl}
        {/* ui-blitz round3 #23 ("one action only"): a second, real action -- there is no email or
            Telegram handle on `Member` to build a genuine contact action from (the directory
            deliberately does not expose that PII to every colleague; MODULE-GUIDE.md/CLAUDE.md keep
            contact details out of surfaces like this), so the honest second action is a shareable
            deep link into this exact profile (`people-screen.tsx` reads `?member=` back out and
            scrolls/highlights the matching card), not a fabricated mailto/tg: link. */}
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() =>
              navigate(`/work?q=${encodeURIComponent(`assignee:"${member.givenName}"`)}`)
            }
          >
            <KanbanSquare className="size-4" aria-hidden="true" />
            {t('structure.people.hoverCard.openBoardColumn')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('structure.people.hoverCard.copyLinkAria', { name: fullName(member) })}
            onClick={() => {
              const url = `${window.location.origin}/people?member=${encodeURIComponent(member.userId)}`
              void navigator.clipboard
                .writeText(url)
                .then(() => toast(t('structure.people.hoverCard.linkCopied')))
            }}
          >
            <LinkIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
