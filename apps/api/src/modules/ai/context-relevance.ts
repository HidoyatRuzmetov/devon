/** A title mentioned inside a long natural-language request must not lose to large unrelated
 * descriptions. This is ranking only: identity and authorization still come from current records. */
export function titleRelevance(title: string, question: string): number {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const label = normalize(title),
    text = normalize(question)
  if (!label) return 0
  if (` ${text} `.includes(` ${label} `)) return 2
  const words = label.split(' ').filter((word) => word.length > 2),
    tokens = new Set(text.split(' '))
  const overlap = words.filter((word) => tokens.has(word)).length
  return overlap >= Math.max(2, Math.ceil(words.length * 0.7)) ? overlap / words.length : 0
}
