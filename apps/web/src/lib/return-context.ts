const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
/** Keep an allow-listed return destination through related drill-ins. */
export function returnContextParams(search: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams()
  const origin = search.get('from')
  if (!origin || !['overview', 'assistant', 'analytics', 'personal'].includes(origin)) return params
  params.set('from', origin)
  const conversation = search.get('conversation')
  if (
    conversation &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(conversation)
  )
    params.set('conversation', conversation)
  for (const key of ['cycle', 'member']) {
    const value = search.get(key)
    if (value && uuid.test(value)) params.set(key, value)
  }
  const month = search.get('month')
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) params.set('month', month)
  return params
}
export function returnDestination(search: URLSearchParams): string {
  const params = returnContextParams(search),
    origin = params.get('from')
  if (origin === 'personal')
    return '/personal?tab=calendar' + (params.has('month') ? '&month=' + params.get('month') : '')
  if (origin === 'analytics') {
    params.delete('from')
    params.delete('conversation')
    params.delete('month')
    return '/analytics' + (params.size ? '?' + params : '')
  }
  if (params.has('conversation')) return '/assistant?conversation=' + params.get('conversation')
  return origin === 'assistant' ? '/assistant' : '/'
}
