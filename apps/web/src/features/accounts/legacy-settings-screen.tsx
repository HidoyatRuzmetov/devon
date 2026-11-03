import { ViewSkeleton } from '../../lib/view-skeleton.js'
import * as React from 'react'
import { navigate, useRoutePath } from '../../lib/router.js'

export default function LegacySettingsScreen() {
  const path = useRoutePath()
  React.useEffect(() => {
    const target = path === '/calendar' ? '/account/calendar' : '/account/department'
    navigate(`${target}${window.location.search}${window.location.hash}`, { replace: true })
  }, [path])
  return <ViewSkeleton view="settings" />
}
