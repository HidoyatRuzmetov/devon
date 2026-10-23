import * as React from 'react'
import { navigate, useSearchParams } from '../../lib/router.js'

/** Keep notification/bookmark entry points while Home owns the inbox experience. */
export default function LegacyInboxScreen() {
  const search = useSearchParams()
  React.useEffect(() => {
    const value = search.get('inbox') ?? search.get('status')
    const status = value === 'unread' || value === 'archived' ? value : 'all'
    navigate(`/?inbox=${status}`, { replace: true })
  }, [search])
  return null
}
