// A member card (TECH-SPEC EPIC-003: "member cards") -- the People directory's grid card (avatar,
// title, unit chip, a hover card with more detail) and, `compact`, the org-chart's role rows.
import { useT } from '@devon/i18n'
import {
  Avatar,
  Badge,
  Chip,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  initialsFromName,
  unitHueClass,
} from '@devon/ui'
import { avatarUrl } from '../../lib/avatar.js'
import type { Member, Unit } from './api.js'

const ROLE_KEY = {
  head: 'structure.roles.roleLabel.head',
  deputy: 'structure.roles.roleLabel.deputy',
  member: 'structure.roles.roleLabel.member',
} as const

export function fullName(m: Pick<Member, 'givenName' | 'familyName' | 'patronymic'>): string {
  return [m.familyName, m.givenName, m.patronymic].filter(Boolean).join(' ')
}

function unitColourClass(unit: Unit): string {
  return unit.colour ? `bg-unit-${unit.colour}` : unitHueClass(unit.id)
}

export function MemberCard({
  member,
  unit,
  compact = false,
}: {
  member: Member
  /** The bo'lim this member belongs to, when known -- renders as a coloured chip (People directory
   * grid card). Omit where the surrounding layout already groups by unit (nothing left to repeat). */
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
        {compact && member.unitRole ? (
          <Badge tone={member.unitRole === 'head' ? 'info' : 'neutral'}>
            {t(ROLE_KEY[member.unitRole])}
          </Badge>
        ) : null}
      </div>
      {!compact ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {unit ? (
            <Chip dotClassName={unitColourClass(unit)} tone="outline">
              {unit.name}
            </Chip>
          ) : (
            <span className="text-caption text-muted-foreground">
              {t('structure.people.memberCard.noUnit')}
            </span>
          )}
          {member.unitRole ? (
            <Badge tone={member.unitRole === 'head' ? 'info' : 'neutral'}>
              {t(ROLE_KEY[member.unitRole])}
            </Badge>
          ) : null}
        </div>
      ) : null}
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
      </HoverCardContent>
    </HoverCard>
  )
}
