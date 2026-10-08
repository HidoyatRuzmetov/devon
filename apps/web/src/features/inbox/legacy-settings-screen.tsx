import * as React from 'react'
import { StateView } from '@devon/ui'
import { navigate, useRoutePath } from '../../lib/router.js'

/** Preserve existing bookmarks and notification links while settings have one canonical home. */
export default function LegacySettingsScreen() {
  const path = useRoutePath()
  React.useEffect(() => {
    const target = path === '/inbox/telegram' ? '/account/telegram' : '/account/notifications'
    navigate(`${target}${window.location.search}${window.location.hash}`, { replace: true })
  }, [path])
  return <StateView kind="loading" titleKey="state.loading" />
}
