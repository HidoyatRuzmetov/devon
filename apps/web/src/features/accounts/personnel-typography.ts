/** Match the Uzbek letter mark in the printed labels for display only. */
export function personnelPaperText(text: string, protectedNames: readonly string[]): string {
  // Lowercase continuations only, so quotations, possessives and names like O'Brien keep their marks.
  return text.replace(
    /([ogOG])['‘’ʼ`](?!s\b)(?=[a-z])/g,
    (match, letter: string, start: number) => {
      const mark = start + 1
      const protectedMark = protectedNames.some((name) => {
        const from = text.lastIndexOf(name, mark)
        return from !== -1 && mark < from + name.length
      })
      return protectedMark ? match : letter + 'ʻ'
    },
  )
}
