/**
 * Bounded spreadsheet / CSV readers for the agent. Caps rows/cols so a huge
 * workbook cannot blow the main-process memory or the model context.
 */

import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import ExcelJS from 'exceljs'

const DEFAULT_MAX_ROWS = 80
const DEFAULT_MAX_COLS = 24
const MAX_CSV_BYTES = 8 * 1024 * 1024

export interface SpreadsheetReadOptions {
  sheet?: string
  maxRows?: number
  maxCols?: number
}

export interface SpreadsheetReadResult {
  path: string
  format: 'csv' | 'xlsx' | 'xls'
  sheet?: string
  sheets?: string[]
  rows: string[][]
  rowCount: number
  colCount: number
  truncated: boolean
  previewMarkdown: string
}

function clamp(n: number | undefined, fallback: number, max: number): number {
  if (n === undefined || !Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(max, Math.floor(n)))
}

/** Minimal CSV split that handles quoted fields and commas. */
export function parseCsv(text: string, maxRows: number, maxCols: number): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let inQuotes = false
  let truncated = false

  const pushCell = (): void => {
    if (row.length < maxCols) row.push(cell)
    else truncated = true
    cell = ''
  }
  const pushRow = (): void => {
    if (row.length === 0 && rows.length === 0) return
    if (rows.length < maxRows) rows.push(row)
    else truncated = true
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushCell()
      i++
      continue
    }
    if (ch === '\n' || ch === '\r') {
      pushCell()
      pushRow()
      if (ch === '\r' && text[i + 1] === '\n') i++
      i++
      if (rows.length >= maxRows) {
        truncated = true
        break
      }
      continue
    }
    cell += ch
    i++
  }
  if (cell.length > 0 || row.length > 0) {
    pushCell()
    pushRow()
  }
  return { rows, truncated }
}

function toMarkdown(rows: string[][]): string {
  if (rows.length === 0) return '_(empty)_'
  const width = Math.max(...rows.map((r) => r.length), 1)
  const norm = rows.map((r) => {
    const cells = r.slice()
    while (cells.length < width) cells.push('')
    return cells.map((c) => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120))
  })
  const header = norm[0]
  const sep = header.map(() => '---')
  const body = norm.slice(1)
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`)
  ]
  return lines.join('\n')
}

async function readXlsx(path: string, opts: SpreadsheetReadOptions): Promise<SpreadsheetReadResult> {
  const maxRows = clamp(opts.maxRows, DEFAULT_MAX_ROWS, 200)
  const maxCols = clamp(opts.maxCols, DEFAULT_MAX_COLS, 50)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const sheetNames = workbook.worksheets.map((ws) => ws.name)
  const ws =
    (opts.sheet ? workbook.getWorksheet(opts.sheet) : undefined) ||
    workbook.worksheets[0]
  if (!ws) {
    return {
      path,
      format: 'xlsx',
      sheets: sheetNames,
      rows: [],
      rowCount: 0,
      colCount: 0,
      truncated: false,
      previewMarkdown: '_(no sheets)_'
    }
  }

  const rows: string[][] = []
  let truncated = false
  let colCount = 0
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rows.length >= maxRows) {
      truncated = true
      return
    }
    // ExcelJS rows are 1-based; skip nothing unless maxed.
    const values = row.values as Array<string | number | boolean | Date | null | undefined>
    // values[0] is unused
    const cells: string[] = []
    for (let c = 1; c <= Math.min(row.cellCount, maxCols); c++) {
      const v = values[c]
      if (v === null || v === undefined) cells.push('')
      else if (v instanceof Date) cells.push(v.toISOString())
      else if (typeof v === 'object' && v && 'text' in (v as object)) cells.push(String((v as { text: string }).text))
      else if (typeof v === 'object' && v && 'result' in (v as object)) cells.push(String((v as { result: unknown }).result ?? ''))
      else cells.push(String(v))
    }
    if (row.cellCount > maxCols) truncated = true
    colCount = Math.max(colCount, cells.length)
    rows.push(cells)
    if (rowNumber > maxRows + 5 && rows.length >= maxRows) truncated = true
  })

  // If more rows exist beyond what we sampled
  if (ws.rowCount > maxRows) truncated = true

  return {
    path,
    format: 'xlsx',
    sheet: ws.name,
    sheets: sheetNames,
    rows,
    rowCount: rows.length,
    colCount,
    truncated,
    previewMarkdown: toMarkdown(rows)
  }
}

function readCsvFile(path: string, opts: SpreadsheetReadOptions): SpreadsheetReadResult {
  const maxRows = clamp(opts.maxRows, DEFAULT_MAX_ROWS, 200)
  const maxCols = clamp(opts.maxCols, DEFAULT_MAX_COLS, 50)
  const st = statSync(path)
  if (st.size > MAX_CSV_BYTES) {
    throw new Error(`CSV too large (${st.size} bytes; max ${MAX_CSV_BYTES})`)
  }
  const text = readFileSync(path, 'utf8')
  const { rows, truncated } = parseCsv(text, maxRows, maxCols)
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)
  return {
    path,
    format: 'csv',
    rows,
    rowCount: rows.length,
    colCount,
    truncated,
    previewMarkdown: toMarkdown(rows)
  }
}

export async function readSpreadsheet(path: string, opts: SpreadsheetReadOptions = {}): Promise<SpreadsheetReadResult> {
  if (!path || !existsSync(path)) throw new Error('File not found')
  const ext = extname(path).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') {
    // TSV: reuse CSV parser after swapping tabs → commas is wrong; handle simply
    if (ext === '.tsv') {
      const maxRows = clamp(opts.maxRows, DEFAULT_MAX_ROWS, 200)
      const maxCols = clamp(opts.maxCols, DEFAULT_MAX_COLS, 50)
      const text = readFileSync(path, 'utf8')
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
      const truncated = lines.length > maxRows
      const rows = lines.slice(0, maxRows).map((line) => line.split('\t').slice(0, maxCols))
      return {
        path,
        format: 'csv',
        rows,
        rowCount: rows.length,
        colCount: rows.reduce((m, r) => Math.max(m, r.length), 0),
        truncated,
        previewMarkdown: toMarkdown(rows)
      }
    }
    return readCsvFile(path, opts)
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    return readXlsx(path, opts)
  }
  if (ext === '.xls') {
    throw new Error('Legacy .xls is not supported. Save as .xlsx or .csv.')
  }
  throw new Error(`Unsupported spreadsheet extension: ${ext || '(none)'}`)
}
