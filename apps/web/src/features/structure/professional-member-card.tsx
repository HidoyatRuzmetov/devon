import * as React from 'react'
import { useT } from '@devon/i18n'
import { Avatar, Button, Sheet, SheetContent, cn, initialsFromName } from '@devon/ui'
import {
  Award,
  BriefcaseBusiness,
  ChevronRight,
  ContactRound,
  ExternalLink,
  GraduationCap,
  Heart,
  Languages,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { professionalProfileSchema } from '@devon/contracts'
import { avatarUrl } from '../../lib/avatar.js'
import { RouterLink } from '../../lib/router.js'
import { unitColorClass } from '../../lib/unit-palette.js'
import type { Member, Unit } from './api.js'

export function fullName(m: Pick<Member, 'givenName' | 'familyName' | 'patronymic'>): string {
  return [m.givenName, m.familyName].filter(Boolean).join(' ')
}
export function formalName(m: Pick<Member, 'givenName' | 'familyName' | 'patronymic'>): string {
  return [m.familyName, m.givenName, m.patronymic].filter(Boolean).join(' ')
}

type SectionIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>
function ProfileSection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: SectionIcon
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h3 className="flex items-center gap-3 text-lead font-semibold">
        <span className="flex size-9 items-center justify-center rounded-md bg-accent text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

export function MemberCard({
  member,
  unit,
  compact = false,
  profileHref,
  onAssign,
  unitColour,
}: {
  member: Member
  unit?: Unit | null
  compact?: boolean
  profileHref?: string | undefined
  onAssign?: (() => void) | undefined
  unitColour?: string
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const profile = member.professionalProfile ?? professionalProfileSchema.parse({})
  const colour =
    unitColour ?? unitColorClass(new Map(), member.unitId, member.membershipRole === 'head')
  const style = {
    '--profile-unit': `var(${colour.replace('bg-', '--color-')})`,
  } as React.CSSProperties
  const education = [...profile.education].sort(
    (a, b) =>
      (b.current ? 2201 : (b.endYear ?? b.startYear ?? 0)) -
      (a.current ? 2201 : (a.endYear ?? a.startYear ?? 0)),
  )
  const experience = [...profile.experience].sort(
    (a, b) =>
      (b.current ? 2201 : (b.endYear ?? b.startYear ?? 0)) -
      (a.current ? 2201 : (a.endYear ?? a.startYear ?? 0)),
  )
  const latestEducation = education[0]
  const empty = t('portal.profile.empty')
  const portrait = (large = false) => (
    <Avatar
      src={avatarUrl(member.avatarKey, 128)}
      size={large ? 'lg' : compact ? 'sm' : 'md'}
      alt={fullName(member)}
      initials={initialsFromName(member.givenName, member.familyName)}
      decorative
      className={cn(colour, large && 'size-20 text-h2 ring-4 ring-card')}
    />
  )
  const period = (
    item: { startYear: number | null; endYear: number | null; current: boolean },
    studying = false,
  ) =>
    [
      item.startYear,
      item.current
        ? studying
          ? item.endYear
            ? `${t('portal.profile.expected')} ${item.endYear}`
            : t('portal.profile.studying')
          : t('portal.profile.present')
        : item.endYear,
    ]
      .filter(Boolean)
      .join(' – ')
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={style}
        data-unit-color={colour}
        className={cn(
          'group flex h-full min-w-0 w-full rounded-lg border border-border border-l-4 border-l-[var(--profile-unit)] bg-card text-left shadow-1 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]',
          compact ? 'items-center gap-2 p-2' : 'flex-col gap-3 p-4',
        )}
      >
        <span className="flex w-full items-center gap-3">
          {portrait()}
          <span className="min-w-0 flex-1">
            <span className="block text-lead font-medium leading-snug">{fullName(member)}</span>
            <span className="mt-1 block text-small text-muted-foreground">
              {profile.headline || member.title || empty}
            </span>
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
        {!compact ? (
          <span className="flex w-full flex-col gap-2.5 border-t border-border pt-3 text-small">
            <span className="flex min-w-0 items-center gap-2.5">
              <Mail className="size-4 shrink-0 text-primary/80" aria-hidden="true" />
              <span className="truncate text-muted-foreground">{member.email || empty}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2.5">
              <Phone className="size-4 shrink-0 text-primary/80" aria-hidden="true" />
              <span className="text-muted-foreground">{profile.phone || empty}</span>
            </span>
            <span className="flex min-w-0 items-start gap-2.5">
              <GraduationCap
                className="mt-0.5 size-4 shrink-0 text-primary/80"
                aria-hidden="true"
              />
              <span className="min-w-0">
                {latestEducation ? (
                  <>
                    <span className="block font-medium">
                      {latestEducation.field ||
                        latestEducation.degree ||
                        latestEducation.institution}
                    </span>
                    <span className="block text-caption text-muted-foreground">
                      {latestEducation.institution}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{empty}</span>
                )}
              </span>
            </span>
          </span>
        ) : null}
      </button>
      <Sheet open={open} onOpenChange={setOpen} direction="right">
        <SheetContent side="right" title={fullName(member)} className="w-full sm:w-[36rem]">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <span className="text-small font-medium text-muted-foreground">
              {t('portal.profile.title')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('structure.units.chart.closePanel')}
              onClick={() => setOpen(false)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]"
            style={style}
          >
            <div className="relative border-b border-border px-5 pb-6 pt-6 sm:px-6">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-24 bg-[color-mix(in_oklab,var(--profile-unit)_14%,var(--color-card))]"
              />
              <div className="relative flex flex-col items-start gap-4">
                {portrait(true)}
                <div className="min-w-0">
                  <h2 className="font-display text-h2 leading-tight">{fullName(member)}</h2>
                  <p className="mt-2 text-lead text-muted-foreground">
                    {profile.headline || member.title || empty}
                  </p>
                </div>
                <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-small">
                  <span
                    className={cn('size-2.5 shrink-0 rounded-full', colour)}
                    aria-hidden="true"
                  />
                  {unit?.name ??
                    t(
                      member.membershipRole === 'head'
                        ? 'headScope.leadership'
                        : 'structure.people.unassignedGroup',
                    )}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-8 p-5 sm:p-6">
              {profile.about ? (
                <ProfileSection title={t('portal.profile.about')} icon={UserRound}>
                  <p className="whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">
                    {profile.about}
                  </p>
                </ProfileSection>
              ) : null}
              <ProfileSection title={t('portal.profile.contact')} icon={ContactRound}>
                <dl className="divide-y divide-border rounded-md border border-border bg-muted/10">
                  {[
                    { label: t('profileEdit.email'), value: member.email, icon: Mail },
                    { label: t('portal.profile.phone'), value: profile.phone, icon: Phone },
                    ...(profile.location
                      ? [
                          {
                            label: t('portal.profile.location'),
                            value: profile.location,
                            icon: MapPin,
                          },
                        ]
                      : []),
                  ].map(({ label, value, icon: Icon }) => (
                    <div
                      key={label}
                      className="grid gap-1.5 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
                    >
                      <dt className="flex items-center gap-2 text-small text-muted-foreground">
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        {label}
                      </dt>
                      <dd className="min-w-0 text-small font-medium">{value || empty}</dd>
                    </div>
                  ))}
                </dl>
                {profile.links.length ? (
                  <div className="flex flex-wrap gap-2">
                    {profile.links.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-small text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <LinkIcon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-all">{link.label || link.url}</span>
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </ProfileSection>
              <ProfileSection title={t('portal.profile.experience')} icon={BriefcaseBusiness}>
                {experience.length ? (
                  <ol className="flex flex-col gap-5">
                    {experience.map((entry, i) => (
                      <li key={i} className="relative border-l-2 border-border pl-5">
                        <span
                          className="absolute -left-1.5 top-1 size-2.5 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        <p className="text-body font-semibold">{entry.role}</p>
                        <p className="mt-1 text-small">{entry.organization}</p>
                        <p className="mt-1 text-caption text-muted-foreground">{period(entry)}</p>
                        {entry.description ? (
                          <p className="mt-3 whitespace-pre-wrap text-small leading-relaxed text-muted-foreground">
                            {entry.description}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-md bg-muted/30 p-3 text-small text-muted-foreground">
                    {empty}
                  </p>
                )}
              </ProfileSection>
              <ProfileSection title={t('portal.profile.education')} icon={GraduationCap}>
                {education.length ? (
                  <ol className="flex flex-col gap-3">
                    {education.map((entry, i) => (
                      <li key={i} className="rounded-md border border-border bg-muted/10 p-4">
                        <p className="text-body font-semibold">{entry.institution}</p>
                        {entry.degree || entry.field ? (
                          <p className="mt-1 text-small">
                            {[entry.degree, entry.field].filter(Boolean).join(' · ')}
                          </p>
                        ) : null}
                        <p className="mt-2 text-caption text-muted-foreground">
                          {period(entry, true)}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-md bg-muted/30 p-3 text-small text-muted-foreground">
                    {empty}
                  </p>
                )}
              </ProfileSection>
              {profile.certifications.length ? (
                <ProfileSection title={t('portal.profile.certifications')} icon={Award}>
                  <div className="grid gap-3">
                    {profile.certifications.map((entry, i) => (
                      <div key={i} className="rounded-md border border-border p-4">
                        <p className="font-medium">{entry.name}</p>
                        <p className="mt-1 text-small text-muted-foreground">
                          {[entry.issuer, entry.year].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </ProfileSection>
              ) : null}
              {(['skills', 'languages', 'hobbies'] as const).map((key) =>
                profile[key].length ? (
                  <ProfileSection
                    key={key}
                    title={t(`portal.profile.${key}`)}
                    icon={key === 'skills' ? Sparkles : key === 'languages' ? Languages : Heart}
                  >
                    <div className="flex flex-wrap gap-2">
                      {profile[key].map((item, index) => (
                        <span
                          key={index}
                          className="min-w-0 rounded-full border border-border bg-accent/50 px-3 py-1.5 text-small text-foreground"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </ProfileSection>
                ) : null,
              )}
            </div>
          </div>
          {profileHref || onAssign ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card p-4">
              {profileHref ? (
                <RouterLink
                  href={profileHref}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-small text-primary hover:bg-accent"
                >
                  <span>{t('structure.people.hoverCard.openProfile')}</span>
                  <ChevronRight className="size-4" aria-hidden="true" />
                </RouterLink>
              ) : null}
              {onAssign ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    onAssign()
                  }}
                >
                  {t('people.person.action.assign')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
