import { ViewSkeleton } from '../../../lib/view-skeleton.js'
import * as React from 'react'
import { navigate } from '../../../lib/router.js'

/** Saved archive URLs lead to the existing completed list, with all restore actions intact. */
export default function LegacyArchiveScreen() {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('q', 'status:archived')
    params.set('completed', '1')
    navigate(`/work/mine?${params.toString()}`, { replace: true })
  }, [])
  return <ViewSkeleton view="table" />
}
