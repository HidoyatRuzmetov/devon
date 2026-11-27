import ExcelJS from 'exceljs'
import { format } from 'ssf'
import type { CSSProperties } from 'react'
import type { Sheet, SheetCell } from './document-formats.js'

function color(value?: Partial<ExcelJS.Color>) {
  // Only literal file colours become CSS. Never interpolate untrusted CSS or URLs.
  const hex = value?.argb?.slice(-6)
  return hex && /^[a-f\d]{6}$/i.test(hex) ? '#' + hex : undefined
}
function border(value?: Partial<ExcelJS.Border>) {
  if (!value?.style) return undefined
  const widths: Record<string, number> = { medium: 2, thick: 3, double: 3 }
  const line = /dash/i.test(value.style)
    ? 'dashed'
    : value.style === 'dotted'
      ? 'dotted'
      : value.style === 'double'
        ? 'double'
        : 'solid'
  return `${widths[value.style] ?? 1}px ${line} ${color(value.color) ?? '#82919b'}`
}
function style(cell: ExcelJS.Cell): CSSProperties {
  const font = cell.font ?? {}
  const align = cell.alignment ?? {}
  const lines = cell.border ?? {}
  const fill = cell.fill
  const textAlign = ['left', 'right', 'center', 'justify'].includes(align.horizontal ?? '')
    ? (align.horizontal as CSSProperties['textAlign'])
    : typeof cell.value === 'number'
      ? 'right'
      : 'left'
  return {
    ...(font.bold ? { fontWeight: 700 } : {}),
    ...(font.italic ? { fontStyle: 'italic' } : {}),
    ...(font.underline || font.strike
      ? {
          textDecoration: [font.underline ? 'underline' : '', font.strike ? 'line-through' : '']
            .join(' ')
            .trim(),
        }
      : {}),
    ...(font.size ? { fontSize: (Math.min(64, Math.max(8, font.size)) * 4) / 3 } : {}),
    ...(font.name
      ? {
          fontFamily: font.name.replace(/[^\p{L}\p{N} _-]/gu, '') + ', sans-serif',
        }
      : {}),
    ...(color(font.color) ? { color: color(font.color) } : {}),
    ...(fill?.type === 'pattern' && color(fill.fgColor)
      ? { backgroundColor: color(fill.fgColor) }
      : {}),
    textAlign,
    verticalAlign:
      align.vertical === 'middle' ? 'middle' : align.vertical === 'top' ? 'top' : 'bottom',
    whiteSpace: align.wrapText ? 'pre-wrap' : 'pre',
    ...(border(lines.top) ? { borderTop: border(lines.top) } : {}),
    ...(border(lines.right) ? { borderRight: border(lines.right) } : {}),
    ...(border(lines.bottom) ? { borderBottom: border(lines.bottom) } : {}),
    ...(border(lines.left) ? { borderLeft: border(lines.left) } : {}),
  }
}
function coordinates(address: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(address)
  if (!match) return null
  const column = [...match[1]!].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0)
  return { row: Number(match[2]), column }
}

// Workers bound parsing time and memory. Formulas are never evaluated; only cached results appear.
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(event.data)
    const sheets: Sheet[] = []
    for (const sheet of book.worksheets.slice(0, 30)) {
      if (sheet.state !== 'visible') continue
      const rowCount = Math.min(1000, sheet.rowCount),
        columnCount = Math.min(100, sheet.columnCount)
      const rows: string[][] = [],
        cells: Record<string, SheetCell> = {}
      const heights: number[] = []
      for (let r = 1; r <= rowCount; r++) {
        const row: string[] = []
        const sourceRow = sheet.getRow(r)
        heights.push(
          sourceRow.hidden ? 0 : Math.min(250, Math.max(24, ((sourceRow.height ?? 18) * 4) / 3)),
        )
        for (let c = 1; c <= columnCount; c++) {
          const cell = sheet.getCell(r, c)
          let value = cell.value
          if (
            value &&
            typeof value === 'object' &&
            ('formula' in value || 'sharedFormula' in value)
          )
            value = value.result ?? null
          let text = cell.text
          if (value instanceof Date || typeof value === 'number') {
            try {
              text = format(
                cell.numFmt || (value instanceof Date ? 'yyyy-mm-dd' : 'General'),
                value,
                { date1904: book.properties.date1904 },
              )
            } catch {
              text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
            }
          } else if (value === null) text = ''
          row.push(text)
          cells[`${r - 1}:${c - 1}`] = { style: style(cell) }
        }
        rows.push(row)
      }
      for (const range of sheet.model.merges ?? []) {
        const [first, last] = range.split(':').map(coordinates)
        if (!first || !last || first.row > rowCount || first.column > columnCount) continue
        const bottom = Math.min(rowCount, last.row),
          right = Math.min(columnCount, last.column)
        for (let r = first.row; r <= bottom; r++)
          for (let c = first.column; c <= right; c++) {
            const key = `${r - 1}:${c - 1}`
            cells[key] =
              r === first.row && c === first.column
                ? {
                    ...cells[key],
                    rowSpan: bottom - first.row + 1,
                    colSpan: right - first.column + 1,
                  }
                : { ...cells[key], covered: true }
          }
      }
      sheets.push({
        name: sheet.name,
        rows,
        cells,
        heights,
        widths: Array.from({ length: columnCount }, (_, index) => {
          const column = sheet.getColumn(index + 1)
          return column.hidden ? 0 : Math.min(600, Math.max(48, (column.width ?? 16) * 7 + 12))
        }),
        truncated: sheet.rowCount > 1000 || sheet.columnCount > 100 || book.worksheets.length > 30,
      })
    }
    self.postMessage({ sheets })
  } catch {
    self.postMessage({ error: true })
  }
}
