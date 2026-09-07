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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  initialsFromName,
} from '@devon/ui'
import { KanbanSquare } from 'lucide-react'
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
}: {
  member: Member
  /** The bo'lim this member belongs to, when known -- surfaced only in the hover card's detail, never
   * on the card's own face, because the grid that renders these cards already groups by unit (a
   * heading, or the active filter chip). */
  unit?: Unit | null
  compact?: boolean
}) {
  const t = useT()
  const body = (
    <div
      className={
        compact
          ? 'flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5'
          : 'flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-1'
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
        <div className="mt-3 flex flex-col gap-1.5 text-small text-muted-foreground">
          <p>
            {t('structure.people.hoverCard.membership')}:{' '}
            {t(
              member.membershipRole === 'head'
                ? 'departments.members.roleHead'
                : 'departments.members.roleMember',
            )}
          </p>
          <p>
            {t('structure.people.hoverCard.unit')}:{' '}
            {unit ? unit.name : t('structure.people.memberCard.noUnit')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() =>
            navigate(`/work?q=${encodeURIComponent(`assignee:"${member.givenName}"`)}`)
          }
        >
          <KanbanSquare className="size-4" aria-hidden="true" />
          {t('structure.people.hoverCard.openBoardColumn')}
        </Button>
      </HoverCardContent>
    </HoverCard>
  )
}
