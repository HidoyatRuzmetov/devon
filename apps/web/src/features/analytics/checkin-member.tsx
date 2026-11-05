import type { CheckinMember } from '@devon/contracts'
import { Avatar, Combobox, cn, initialsFromName } from '@devon/ui'
import { useT } from '@devon/i18n'
import { avatarUrl } from '../../lib/avatar.js'
import { createUnitPalette, unitColorClass } from '../../lib/unit-palette.js'
import './checkin-member.css'

type ChooserMember = Pick<
  CheckinMember,
  'userId' | 'givenName' | 'familyName' | 'avatarKey' | 'unitId'
>

export function memberName(member: ChooserMember) {
  return `${member.givenName} ${member.familyName}`.trim()
}
export function MemberAvatar({
  member,
  large = false,
}: {
  member: ChooserMember
  large?: boolean
}) {
  return (
    <Avatar
      decorative
      alt={memberName(member)}
      src={avatarUrl(member.avatarKey)}
      initials={initialsFromName(member.givenName, member.familyName)}
      hueSeed={member.unitId ?? member.userId}
      className={large ? 'size-14 text-h3 shrink-0' : 'shrink-0'}
      size={large ? 'lg' : 'sm'}
    />
  )
}
export function CheckinMemberChooser({
  data,
  selected,
  onChange,
  label,
}: {
  data: { units: readonly { id: string }[]; members: readonly ChooserMember[] }
  selected: ChooserMember | undefined
  onChange: (id: string) => void
  label?: string
}) {
  const t = useT(),
    palette = createUnitPalette(data.units)
  const render = (option: { value: string }) => {
    const member = data.members.find((m) => m.userId === option.value)!
    return (
      <span className="checkin-person-option">
        <span
          aria-hidden="true"
          className={cn('checkin-unit-dot', unitColorClass(palette, member.unitId))}
        />
        <MemberAvatar member={member} />
        <span className="truncate">{memberName(member)}</span>
      </span>
    )
  }
  return (
    <Combobox
      className="checkin-person-chooser"
      label={label ?? t('checkins.people')}
      placeholder={t('checkins.people')}
      searchPlaceholder={t('checkins.searchPeople')}
      emptyMessage={t('checkins.noMembers')}
      value={selected?.userId ?? null}
      onValueChange={onChange}
      options={data.members.map((m) => ({ value: m.userId, label: memberName(m) }))}
      renderOption={render}
      renderValue={render}
    />
  )
}
