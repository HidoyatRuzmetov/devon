// `/departments` -- the fresh-account landing ("Create a department or join one", TECH-SPEC §2.1)
// when the signed-in user has no membership yet, and the department switcher/list once they do.
import { useQuery } from '@tanstack/react-query'
import { Building2, Plus, Users } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Badge, Button, StateView } from '@devon/ui'
import { useSession, useDepartment } from '../../lib/session.js'
import { navigate, Link } from '../../lib/router.js'
import { fetchMyDepartments } from './api.js'

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
    return <StateView kind="error" titleKey="state.error.title" bodyKey="state.error.body" />
  }

  const departments = query.data?.departments ?? []

  if (departments.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
        <Building2 className="size-12 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h1 className="text-h2 text-foreground">{t('departments.landing.title')}</h1>
          <p className="text-small text-muted-foreground">{t('departments.landing.body')}</p>
        </div>
        <div className="flex gap-3">
          <Button size="lg" onClick={() => navigate('/departments/new')}>
            {t('departments.landing.createCta')}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/join')}>
            {t('departments.landing.joinCta')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h2 text-foreground">{t('departments.title')}</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate('/join')}>
            {t('departments.landing.joinCta')}
          </Button>
          <Button size="sm" onClick={() => navigate('/departments/new')}>
            <Plus className="size-4" aria-hidden="true" /> {t('departments.landing.createCta')}
          </Button>
        </div>
      </div>

      {departments.length > 1 ? (
        <label className="flex w-fit flex-col gap-1.5">
          <span className="text-small text-foreground">{t('departments.switcher.label')}</span>
          <select
            className="h-11 w-64 rounded-sm border border-border bg-card px-3 text-body text-foreground"
            value={activeDepartmentId ?? ''}
            onChange={(e) => setDepartmentId(e.target.value || null)}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.emoji ? `${d.emoji} ` : ''}
                {d.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {departments.map((d) => (
          <li key={d.id}>
            <Link
              to={`/department?id=${d.id}`}
              onClick={() => setDepartmentId(d.id)}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-4 hover:bg-accent"
            >
              <div className="flex items-center justify-between">
                <span className="text-body font-medium text-foreground">
                  {d.emoji ? `${d.emoji} ` : ''}
                  {d.name}
                </span>
                <div className="flex items-center gap-1.5">
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
          </li>
        ))}
      </ul>
    </div>
  )
}
