/**
 * file-parser.ts
 * Parses CSV files (semicolon or comma delimited), German number formats,
 * German date formats, and extracts salary month references from text.
 */

// ---------------------------------------------------------------------------
// German number parsing
// ---------------------------------------------------------------------------

/**
 * Parse a German-formatted number string into a JavaScript number.
 *
 * Handles all real-world payroll edge cases:
 *   "2.550,00"   -> 2550.00    (standard German format)
 *   "1234,56"    -> 1234.56    (no thousands separator)
 *   "-234,56"    -> -234.56    (leading minus)
 *   "885,00-"    -> -885.00    (trailing minus — German accounting format)
 *   "Z   58,71"  -> 58.71      (leading letter prefix, e.g. "Zuschuss")
 *   "1234.56"    -> 1234.56    (already standard format — also accepted)
 *
 * Returns null if the string cannot be parsed as a number.
 */
export function parseGermanNumber(value: string): number | null {
  if (!value || typeof value !== 'string') return null

  let trimmed = value.trim()
  if (trimmed === '' || trimmed === '-' || trimmed === '+') return null

  // Remove internal whitespace
  trimmed = trimmed.replace(/\s+/g, '')

  // Detect trailing minus (German accounting negative): "885,00-" → "-885,00"
  let trailingMinus = false
  if (trimmed.endsWith('-')) {
    trailingMinus = true
    trimmed = trimmed.slice(0, -1)
  }

  // Strip any leading non-numeric prefix characters (e.g. "Z" in "Z58,71")
  // Keep: digits, plus, minus, dot, comma
  trimmed = trimmed.replace(/^[^0-9+\-.,]+/, '')

  if (trimmed === '') return null

  let num: number

  // German format: comma as decimal separator
  // Matches: optional sign, digits, optional (dot+3digits)*, comma, digits
  const germanPattern = /^[+-]?\d{1,3}(?:\.\d{3})*,\d+$/
  const germanNoThousands = /^[+-]?\d+,\d+$/
  // Integer with thousands dots: "1.234" — only if no comma follows
  const germanInteger = /^[+-]?\d{1,3}(?:\.\d{3})+$/

  if (germanPattern.test(trimmed) || germanNoThousands.test(trimmed)) {
    const normalized = trimmed.replace(/\./g, '').replace(',', '.')
    num = parseFloat(normalized)
  } else if (germanInteger.test(trimmed)) {
    // "1.234" treated as 1234, not 1.234
    num = parseFloat(trimmed.replace(/\./g, ''))
  } else {
    num = parseFloat(trimmed)
  }

  if (isNaN(num)) return null
  return trailingMinus ? -Math.abs(num) : num
}

// ---------------------------------------------------------------------------
// German date parsing
// ---------------------------------------------------------------------------

/**
 * Parse a German-formatted date string into a Date object.
 *
 * Supported formats:
 *   DD.MM.YYYY  -> e.g. 31.12.2025
 *   DD.MM.YY   -> e.g. 31.12.25 (2000-2099 assumed)
 *
 * Returns null if parsing fails.
 */
export function parseGermanDate(value: string): Date | null {
  if (!value || typeof value !== 'string') return null

  const trimmed = value.trim()

  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (!match) return null

  const day = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  let year = parseInt(match[3], 10)

  if (year < 100) year += 2000

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return date
}

// ---------------------------------------------------------------------------
// Salary month extraction
// ---------------------------------------------------------------------------

const GERMAN_MONTHS: Record<string, number> = {
  januar: 1, jan: 1,
  februar: 2, feb: 2,
  maerz: 3, märz: 3, mar: 3, mär: 3,
  april: 4, apr: 4,
  mai: 5, may: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  dezember: 12, dez: 12, dec: 12,
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Extract a salary month from a text string.
 * Returns YYYY-MM string or null.
 */
export function extractSalaryMonth(
  text: string,
  fallbackDate?: Date
): string | null {
  if (text && typeof text === 'string') {
    const t = text.trim()

    // 1. ISO format: YYYY-MM
    const isoMatch = t.match(/\b(\d{4})-(\d{2})\b/)
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10)
      const month = parseInt(isoMatch[2], 10)
      if (month >= 1 && month <= 12) return `${year}-${zeroPad(month)}`
    }

    // 2. MM/YYYY
    const slashMatch = t.match(/\b(\d{1,2})\/(\d{4})\b/)
    if (slashMatch) {
      const month = parseInt(slashMatch[1], 10)
      const year = parseInt(slashMatch[2], 10)
      if (month >= 1 && month <= 12) return `${year}-${zeroPad(month)}`
    }

    // 3. MM.YYYY (but not DD.MM.YYYY)
    const dotMatch = t.match(/(?<!\d\.)(\b\d{1,2})\.(\d{4})\b/)
    if (dotMatch) {
      const month = parseInt(dotMatch[1], 10)
      const year = parseInt(dotMatch[2], 10)
      if (month >= 1 && month <= 12) return `${year}-${zeroPad(month)}`
    }

    // 4. German/English month name + year (e.g. "Mai 2026", "Januar 2025")
    const lower = t.toLowerCase()
    for (const [monthName, monthNum] of Object.entries(GERMAN_MONTHS)) {
      const regex = new RegExp(`\\b${monthName}\\b[\\s.,/-]*(\\d{4})`, 'i')
      const match = lower.match(regex)
      if (match) {
        const year = parseInt(match[1], 10)
        return `${year}-${zeroPad(monthNum)}`
      }
    }
  }

  // Fallback: one month before fallbackDate
  if (fallbackDate instanceof Date && !isNaN(fallbackDate.getTime())) {
    const d = new Date(fallbackDate)
    d.setDate(1)
    d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${zeroPad(d.getMonth() + 1)}`
  }

  return null
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

// Keywords that indicate a row is a real header row (not metadata)
const PAYROLL_HEADER_KEYWORDS = [
  'pers.-nr.', 'personalnummer', 'pers.nr', 'pers-nr',
  'auszahlungsbetrag', 'gesamt-brutto', 'lohnsteuer',
  'kv-brutto', 'rv-brutto', 'kv-beitrag', 'rv-beitrag',
]

const BANK_HEADER_KEYWORDS = [
  'auftragskonto', 'buchungstag', 'valutadatum',
  'verwendungszweck', 'beguenstigter', 'betrag', 'waehrung',
]

/**
 * Detect the delimiter used in a CSV file.
 */
function detectDelimiter(lines: string[]): ';' | ',' {
  const sampleLines = lines.slice(0, Math.min(10, lines.length))
  let semicolons = 0
  let commas = 0

  for (const line of sampleLines) {
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') inQuote = !inQuote
      else if (!inQuote) {
        if (ch === ';') semicolons++
        else if (ch === ',') commas++
      }
    }
  }

  return semicolons >= commas ? ';' : ','
}

/**
 * Parse a single CSV line into fields, handling double-quote escaping.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuote = false
  let i = 0

  while (i < line.length) {
    const ch = line[i]

    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i += 2
          continue
        } else {
          inQuote = false
          i++
          continue
        }
      } else {
        current += ch
        i++
        continue
      }
    }

    if (ch === '"') { inQuote = true; i++; continue }
    if (ch === delimiter) { fields.push(current); current = ''; i++; continue }
    current += ch
    i++
  }

  fields.push(current)
  return fields
}

/**
 * Score how likely a parsed row is to be a header row.
 * Returns a score 0–100.
 */
function headerScore(fields: string[]): number {
  const lower = fields.map(f => f.toLowerCase().trim())
  const allText = lower.join(' ')
  let score = 0

  for (const kw of PAYROLL_HEADER_KEYWORDS) {
    if (allText.includes(kw)) score += 15
  }
  for (const kw of BANK_HEADER_KEYWORDS) {
    if (allText.includes(kw)) score += 15
  }

  // Penalise rows that look like data (mostly numbers or empty)
  const nonEmpty = fields.filter(f => f.trim() !== '')
  const numericCount = nonEmpty.filter(f => /^[0-9.,Z\s\-+]+$/.test(f.trim())).length
  if (nonEmpty.length > 0 && numericCount / nonEmpty.length > 0.6) score -= 30

  return Math.max(0, score)
}

export interface ParsedCSV {
  headers: string[]
  rows: string[][]
  /** Lines that appeared before the header row (company name, month, etc.) */
  metadataLines: string[]
}

/**
 * Parse a CSV file content (string or Buffer) into headers and row arrays.
 *
 * Key behaviour:
 * - Removes UTF-8 / Latin-1 BOM if present
 * - Auto-detects semicolon vs comma delimiter
 * - Scans up to the first 10 lines to find the REAL header row
 *   (payroll files have 4 metadata lines before the actual column headers)
 * - Returns metadataLines so callers can extract company name / salary month
 */
export function parseCSV(content: string | Buffer): ParsedCSV {
  let text: string
  if (Buffer.isBuffer(content)) {
    // Try latin1 first (Sparkasse / DATEV files are often ISO-8859-1)
    text = content.toString('latin1')
  } else {
    text = content
  }

  // Strip BOM (UTF-8: EF BB BF, or latin1 byte 0xFE/0xFF at start)
  if (text.charCodeAt(0) === 0xfeff || text.charCodeAt(0) === 0xfe || text.charCodeAt(0) === 0xff) {
    text = text.slice(1)
  }

  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  if (lines.length === 0) return { headers: [], rows: [], metadataLines: [] }

  const delimiter = detectDelimiter(lines)

  // ── Find the real header row ──────────────────────────────────────────────
  // Scan the first 10 lines and pick the one with the highest header score.
  // Fall back to line 0 if nothing scores above 0.
  let headerLineIdx = 0
  let bestScore = -1

  const scanLimit = Math.min(10, lines.length)
  for (let i = 0; i < scanLimit; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trim() === ';') continue
    const fields = parseCsvLine(line, delimiter).map(f => f.trim())
    const score = headerScore(fields)
    if (score > bestScore) {
      bestScore = score
      headerLineIdx = i
    }
  }

  const metadataLines = lines.slice(0, headerLineIdx)
  const headerLine = lines[headerLineIdx]
  const dataLines = lines.slice(headerLineIdx + 1)

  const headers = parseCsvLine(headerLine, delimiter).map(h => h.trim())

  const rows: string[][] = []
  for (const line of dataLines) {
    if (line.trim() === '' || line.trim() === ';') continue
    const fields = parseCsvLine(line, delimiter).map(f => f.trim())
    // Skip rows that are entirely empty or just semicolons
    if (fields.every(f => f === '')) continue
    rows.push(fields)
  }

  return { headers, rows, metadataLines }
}
