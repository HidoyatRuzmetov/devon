// `/departments` -- the fresh-account landing ("Create a department or join one", TECH-SPEC §2.1)
// when the signed-in user has no membership yet, and the department switcher/list once they do.
// Rebuilt to UI-OVERHAUL.md's Jakob row "Departments hub / join" (Slack workspaces, Discord invite):
// create-or-join as two big illustrated cards, the ambient gradient hub treatment (DESIGN.md v2 §2.6
// -- allowed here because this is a hub screen, never behind a working board or a form).
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Building2, Plus, Users } from 'lucide-react'
import { useT } from '@devon/i18n'
import {
  AmbientGradient,
  Badge,
  Button,
  HoverLift,
  PageHeader,
  Reveal,
  Stagger,
  StaggerItem,
  StateView,
  cardVariants,
  cn,
} from '@devon/ui'
import { useSession, useDepartment } from '../../lib/session.js'
import { navigate, Link } from '../../lib/router.js'
import { fetchMyDepartments } from './api.js'
import {
  CreateDepartmentIllustration,
  JoinDepartmentIllustration,
} from './components/illustrations.js'

function ChoiceCard({
  illustration,
  titleKey,
  bodyKey,
  ctaKey,
  onClick,
}: {
  illustration: ReactNode
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

export default function DepartmentsHubScreen() {
  const t = useT()
  const session = useSession()
  const { departmentId: activeDepartmentId, setDepartmentId } = useDepartment()
  const query = useQuery({
    queryKey: ['departments', 'mine'],
    queryFn: fetchMyDepartments,
    enabled: session.isAuthenticated,
  })

  if (session.isLoading || (session.isAuthenticated && query.isPending)) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
      />
    )
  }

  const departments = query.data?.departments ?? []

  if (departments.length === 0) {
    return (
      <div className="relative flex flex-col gap-8">
        <AmbientGradient variant="hub" />
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
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

      <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {departments.map((d) => (
          <StaggerItem key={d.id} className="h-full">
            <HoverLift className="h-full rounded-md">
              <Link
                to={`/department?id=${d.id}`}
                onClick={() => setDepartmentId(d.id)}
                className={cn(
                  cardVariants(),
                  'flex h-full flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    {d.id === activeDepartmentId ? (
                      <Badge tone="success">{t('departments.switcher.current')}</Badge>
                    ) : null}
                    <Badge tone={d.myRole === 'head' ? 'info' : 'neutral'}>
                      {t(
                        d.myRole === 'head'
                          ? 'departments.members.roleHead'
                          : 'departments.members.roleMember',
                      )}
                    </Badge>
                  </div>
                </div>
                <span className="flex items-center gap-1 text-small text-muted-foreground">
                  <Users className="size-3.5" aria-hidden="true" /> {d.memberCount}
                </span>
              </Link>
            </HoverLift>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  )
}
