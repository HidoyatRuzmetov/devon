import { professionalProfileSchema } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Avatar, Button, Sheet, SheetContent, cn, initialsFromName } from '@devon/ui'
import {
  Award,
  BookUser,
  BriefcaseBusiness,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  Heart,
  Languages,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  Puzzle,
  UserRound,
  Wrench,
  X,
} from 'lucide-react'
import * as React from 'react'
import { avatarUrl } from '../../lib/avatar.js'
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
    <section className="flex min-w-0 flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-2 text-body font-semibold">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-accent/60 text-primary">
          <Icon className="size-4" aria-hidden="true" />
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
  onAssign,
  unitColour,
}: {
  member: Member
  unit?: Unit | null
  compact?: boolean
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
      className={cn(colour, large && 'size-16 shrink-0 text-lead')}
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
            <div data-profile-identity className="border-b border-border px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                {portrait(true)}
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-h2 leading-tight">{fullName(member)}</h2>
                  <p className="mt-1 text-body text-muted-foreground">
                    {profile.headline || member.title || empty}
                  </p>
                  <p className="mt-2 flex items-start gap-2 text-caption text-muted-foreground">
                    <span
                      className={cn('mt-1 size-2 shrink-0 rounded-full', colour)}
                      aria-hidden="true"
                    />
                    <span>
                      {unit?.name ??
                        t(
                          member.membershipRole === 'head'
                            ? 'headScope.leadership'
                            : 'structure.people.unassignedGroup',
                        )}
                    </span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-4 px-5 py-4 sm:px-6">
              <ProfileSection title={t('portal.profile.contact')} icon={BookUser}>
                <dl
                  data-profile-contacts
                  className={cn(
                    'grid gap-x-4 gap-y-3',
                    profile.location ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
                  )}
                >
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
                    <div key={label} className="grid min-w-0 content-start gap-1">
                      <dt className="flex items-center gap-2 text-caption text-muted-foreground">
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        {label}
                      </dt>
                      <dd className="min-w-0 text-small [overflow-wrap:anywhere]">
                        {value || empty}
                      </dd>
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
                        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-small text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <LinkIcon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-all">{link.label || link.url}</span>
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </ProfileSection>
              {profile.about ? (
                <ProfileSection title={t('portal.profile.about')} icon={UserRound}>
                  <p className="whitespace-pre-wrap text-small leading-relaxed text-muted-foreground">
                    {profile.about}
                  </p>
                </ProfileSection>
              ) : null}
              <ProfileSection title={t('portal.profile.experience')} icon={BriefcaseBusiness}>
                {experience.length ? (
                  <ol className="flex flex-col gap-4">
                    {experience.map((entry, i) => (
                      <li key={i} className="relative border-l border-border pl-4">
                        <span
                          className="absolute -left-1 top-1.5 size-2 rounded-full bg-primary/70"
                          aria-hidden="true"
                        />
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <p className="text-small font-semibold">{entry.role}</p>
                          <p className="text-caption text-muted-foreground">{period(entry)}</p>
                        </div>
                        <p className="mt-0.5 text-small text-muted-foreground">
                          {entry.organization}
                        </p>
                        {entry.description ? (
                          <p className="mt-2 whitespace-pre-wrap text-small leading-relaxed text-muted-foreground">
                            {entry.description}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-small text-muted-foreground">{empty}</p>
                )}
              </ProfileSection>
              <ProfileSection title={t('portal.profile.education')} icon={GraduationCap}>
                {education.length ? (
                  <ol className="flex flex-col gap-3">
                    {education.map((entry, i) => (
                      <li key={i} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <p className="text-small font-semibold">{entry.institution}</p>
                          <p className="text-caption text-muted-foreground">
                            {period(entry, true)}
                          </p>
                        </div>
                        {entry.degree || entry.field ? (
                          <p className="mt-1 text-small">
                            {[entry.degree, entry.field].filter(Boolean).join(' · ')}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-small text-muted-foreground">{empty}</p>
                )}
              </ProfileSection>
              {profile.certifications.length ? (
                <ProfileSection title={t('portal.profile.certifications')} icon={Award}>
                  <div className="grid gap-3">
                    {profile.certifications.map((entry, i) => (
                      <div
                        key={i}
                        className="border-b border-border pb-3 last:border-b-0 last:pb-0"
                      >
                        <p className="text-small font-semibold">{entry.name}</p>
                        <p className="mt-1 text-small text-muted-foreground">
                          {[entry.issuer, entry.year].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </ProfileSection>
              ) : null}
              {profile.skills.length || profile.languages.length || profile.hobbies.length ? (
                <ProfileSection title={t('settings.profile.capabilitiesInterests')} icon={Puzzle}>
                  <div className="space-y-3" data-profile-capabilities>
                    {(['skills', 'languages', 'hobbies'] as const).map((key) =>
                      profile[key].length ? (
                        <div
                          key={key}
                          className="grid min-w-0 grid-cols-[minmax(7rem,0.35fr)_minmax(0,1fr)] items-start gap-3"
                        >
                          <h4 className="flex items-start gap-2 pt-1 text-caption font-medium text-muted-foreground">
                            {key === 'languages' ? (
                              <Languages className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            ) : key === 'hobbies' ? (
                              <Heart className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <Wrench className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span>{t(`portal.profile.${key}`)}</span>
                          </h4>
                          <div className="flex min-w-0 flex-wrap gap-1.5">
                            {profile[key].map((item, index) => (
                              <span
                                key={index}
                                className="min-w-0 rounded-sm bg-muted/50 px-2 py-1 text-caption text-foreground"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null,
                    )}
                  </div>
                </ProfileSection>
              ) : null}
            </div>
          </div>
          {onAssign ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card p-4">
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
