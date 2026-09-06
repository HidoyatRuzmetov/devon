// Turns an `{ filename, content }` ICS response (`GET /events/:id/ics`, `GET /events/ics/me`) into a
// real file save -- the browser's native "Save As" via a transient object URL, exactly the way any
// other client-side export in a normal web app works (this is not a sandboxed Artifact preview).
export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
