// Preserve bookmarked and notification URLs while using the single card drawer everywhere.
import * as React from 'react'
import { navigate, useSearchParams } from '../../../lib/router.js'
import { returnContextParams } from '../../../lib/return-context.js'
export default function CardPageScreen() {
  const search = useSearchParams()
  React.useEffect(() => {
    const id = search.get('id'),
      params = returnContextParams(search)
    if (id) params.set('card', id)
    const analytics = search.get('from') === 'analytics'
    if (analytics)
      for (const key of ['cycle', 'member']) {
        const value = search.get(key)
        if (value) params.set(key, value)
      }
    navigate(`${analytics ? '/analytics' : '/work'}${params.size ? `?${params}` : ''}`, {
      replace: true,
    })
  }, [search])
  return null
}
