/** Keep the verified Home/Assistant return destination through related drill-ins. */
export function returnContextParams(search: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams()
  const origin = search.get('from')
  if (origin !== 'overview' && origin !== 'assistant') return params
  params.set('from', origin)
  const conversation = search.get('conversation')
  if (
    conversation &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(conversation)
  )
    params.set('conversation', conversation)
  return params
}
