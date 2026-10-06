/** Some GLM deployments serialize absent nullable fields as Python's "None" string.
 * Repair that wire-format defect only where the declared tool schema permits null.
 * Ordinary prose, titles, enum values and unknown properties are never coerced. */
export function normalizeToolArguments(value: unknown, schema: Record<string, unknown>): unknown {
  const type = schema['type']
  const nullable = type === 'null' || (Array.isArray(type) && type.includes('null'))
  if (nullable && typeof value === 'string' && /^(none|null)$/i.test(value.trim())) return null
  if (Array.isArray(value)) {
    const items = schema['items']
    return items && typeof items === 'object' && !Array.isArray(items)
      ? value.map((item) => normalizeToolArguments(item, items as Record<string, unknown>))
      : value
  }
  const properties = schema['properties']
  if (value && typeof value === 'object' && properties && typeof properties === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const child = (properties as Record<string, unknown>)[key]
        return [
          key,
          child && typeof child === 'object' && !Array.isArray(child)
            ? normalizeToolArguments(item, child as Record<string, unknown>)
            : item,
        ]
      }),
    )
  }
  return value
}
