import ExcelJS from 'exceljs'

// Parsing user spreadsheets stays off the interface thread and is terminated by the caller on
// cancellation or timeout. Formula results are read from the file; formulas are never evaluated.
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(event.data)
    const sheets = []
    for (const sheet of book.worksheets.slice(0, 30)) {
      if (sheet.state !== 'visible') continue
      const rows: string[][] = []
      for (let r = 1; r <= Math.min(1000, sheet.rowCount); r++) {
        const row: string[] = []
        for (let c = 1; c <= Math.min(100, sheet.columnCount); c++) {
          const cell = sheet.getCell(r, c)
          const value = cell.value
          if (value instanceof Date) row.push(value.toISOString().slice(0, 10))
          else if (
            value &&
            typeof value === 'object' &&
            ('formula' in value || 'sharedFormula' in value)
          )
            row.push(value.result === undefined ? '' : String(value.result))
          else row.push(cell.text)
        }
        rows.push(row)
      }
      sheets.push({
        name: sheet.name,
        rows,
        truncated: sheet.rowCount > 1000 || sheet.columnCount > 100 || book.worksheets.length > 30,
      })
    }
    self.postMessage({ sheets })
  } catch {
    self.postMessage({ error: true })
  }
}
