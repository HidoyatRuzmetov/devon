// `/people/me` -- the one person page a xodim may open (v1.1 SPEC §6: "a member sees only their
// own"). The server answers `/api/v1/people/me/*` on `{kind:'own_account'}`, so this route needs no
// head permission and shows no head-only actions: `canManage` comes back `false` and the page hides
// the assign/message column for itself.
//
// It is also where a head lands when they click their own name -- the same page, with `canManage`
// true, because a head is a xodim too.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { PageContainer, PageHeader, StateView } from '@devon/ui'
import { useForcedState } from '../../lib/forced-state.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { useOnline } from '../../lib/use-online.js'
import { useSession } from '../../lib/session.js'
import { navigate, RouterLink } from '../../lib/router.js'
import { PersonPage } from './person/person-page.js'

export default function MyProfileScreen(): React.JSX.Element {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const session = useSession()

  if (forced) return <ForcedStateBlock kind={forced} />
  if (!online) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
      />
    )
  }
  if (!session.isAuthenticated) {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="state.denied.body"
        action={{ labelKey: 'state.denied.action', onAction: () => navigate('/login') }}
      />
    )
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t('structure.nav.people')}
        title={t('people.person.own.title')}
        description={t('people.person.own.description')}
      />
      <div className="mt-5">
        <RouterLink
          href="/account#section-profile"
          className="mb-4 inline-flex text-small text-primary underline"
        >
          {t('profileEdit.edit')}
        </RouterLink>
        <PersonPage userId="me" />
      </div>
    </PageContainer>
  )
}
