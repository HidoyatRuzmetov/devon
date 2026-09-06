// A member card (TECH-SPEC EPIC-003: "member cards") -- used by the People page and, smaller, inside
// the org chart's unit nodes.
import { useT } from '@devon/i18n'
import { Avatar, Badge, initialsFromName } from '@devon/ui'
import type { Member } from './api.js'

const ROLE_KEY = {
  head: 'structure.roles.roleLabel.head',
  deputy: 'structure.roles.roleLabel.deputy',
  member: 'structure.roles.roleLabel.member',
} as const

export function fullName(m: Pick<Member, 'givenName' | 'familyName' | 'patronymic'>): string {
  return [m.familyName, m.givenName, m.patronymic].filter(Boolean).join(' ')
}

export function MemberCard({ member, compact = false }: { member: Member; compact?: boolean }) {
  const t = useT()
  return (
    <div
      className={
        compact
          ? 'flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5'
          : 'flex items-center gap-3 rounded-md border border-border bg-card p-3 shadow-1'
      }
    >
      <Avatar
        size={compact ? 'sm' : 'md'}
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
        {!compact && member.title ? (
          <p className="truncate text-caption text-muted-foreground">{member.title}</p>
        ) : null}
      </div>
      {member.unitRole ? (
        <Badge tone={member.unitRole === 'head' ? 'info' : 'neutral'}>
          {t(ROLE_KEY[member.unitRole])}
        </Badge>
      ) : !compact ? (
        <span className="text-caption text-muted-foreground">
          {t('structure.people.memberCard.noUnit')}
        </span>
      ) : null}
    </div>
  )
}
