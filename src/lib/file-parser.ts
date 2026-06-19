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
 * German format uses period as thousands separator and comma as decimal separator:
 *   "1.234,56" -> 1234.56
 *   "1234,56"  -> 1234.56
 *   "-234,56"  -> -234.56
 *   "1234.56"  -> 1234.56 (already standard format — also accepted)
 *
 * Returns null if the string cannot be parsed as a number.
 */
export function parseGermanNumber(value: string): number | null {
  if (!value || typeof value !== 'string') return null

  const trimmed = value.trim().replace(/\s/g, '')
  if (trimmed === '' || trimmed === '-' || trimmed === '+') return null

  // Detect German format: has comma as decimal separator
  // Pattern: optional sign, digits, optional (dot+3digits)*, comma, digits
  const germanPattern = /^[+-]?\d{1,3}(?:\.\d{3})*,\d+$/
  const germanNoThousands = /^[+-]?\d+,\d+$/

  if (germanPattern.test(trimmed) || germanNoThousands.test(trimmed)) {
    // Remove thousands separators (dots) and replace comma with dot
    const normalized = trimmed.replace(/\./g, '').replace(',', '.')
    const num = parseFloat(normalized)
    return isNaN(num) ? null : num
  }

  // Try standard format (dot as decimal separator)
  const num = parseFloat(trimmed)
  return isNaN(num) ? null : num
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

  // 2-digit year: treat as 2000+
  if (year < 100) {
    year += 2000
  }

  // Basic range validation
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  const date = new Date(year, month - 1, day)

  // Verify the date is valid (e.g., not Feb 30)
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
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  maerz: 3,
  märz: 3,
  mar: 3,
  mär: 3,
  april: 4,
  apr: 4,
  mai: 5,
  may: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
  dec: 12,
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Extract a salary month from a text string.
 *
 * Recognized patterns (in priority order):
 *   1. ISO: "2026-05"
 *   2. Numeric with slash: "05/2026"
 *   3. Numeric with dot: "05.2026"
 *   4. German month name + year: "Mai 2026", "Januar 2025"
 *
 * Returns YYYY-MM string or null.
 *
 * If no pattern is found and fallbackDate is provided, returns one month before
 * fallbackDate as the salary month.
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
      if (month >= 1 && month <= 12) {
        return `${year}-${zeroPad(month)}`
      }
    }

    // 2. MM/YYYY
    const slashMatch = t.match(/\b(\d{1,2})\/(\d{4})\b/)
    if (slashMatch) {
      const month = parseInt(slashMatch[1], 10)
      const year = parseInt(slashMatch[2], 10)
      if (month >= 1 && month <= 12) {
        return `${year}-${zeroPad(month)}`
      }
    }

    // 3. MM.YYYY (but not DD.MM.YYYY — require start of string or non-digit before)
    const dotMatch = t.match(/(?<!\d\.)(\b\d{1,2})\.(\d{4})\b/)
    if (dotMatch) {
      const month = parseInt(dotMatch[1], 10)
      const year = parseInt(dotMatch[2], 10)
      if (month >= 1 && month <= 12) {
        return `${year}-${zeroPad(month)}`
      }
    }

    // 4. German month name + year
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

/**
 * Detect the delimiter used in a CSV file.
 * Returns ';' or ',' based on frequency in the first few lines.
 */
function detectDelimiter(lines: string[]): ';' | ',' {
  const sampleLines = lines.slice(0, Math.min(5, lines.length))
  let semicolons = 0
  let commas = 0

  for (const line of sampleLines) {
    // Count outside quoted regions
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
        // Check for escaped quote ("")
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

    if (ch === '"') {
      inQuote = true
      i++
      continue
    }

    if (ch === delimiter) {
      fields.push(current)
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  fields.push(current)
  return fields
}

/**
 * Parse a CSV file content (string or Buffer) into headers and row arrays.
 *
 * Features:
 * - Removes UTF-8 BOM if present
 * - Auto-detects semicolon vs comma delimiter
 * - Handles quoted fields with embedded delimiters and escaped quotes
 * - Trims whitespace from field values
 */
export function parseCSV(
  content: string | Buffer
): { headers: string[]; rows: string[][] } {
  // Convert buffer to string
  let text: string
  if (Buffer.isBuffer(content)) {
    text = content.toString('utf-8')
  } else {
    text = content
  }

  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
  }

  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }

  if (lines.length === 0) {
    return { headers: [], rows: [] }
  }

  const delimiter = detectDelimiter(lines)

  const [headerLine, ...dataLines] = lines
  const headers = parseCsvLine(headerLine, delimiter).map((h) => h.trim())

  const rows: string[][] = []

  for (const line of dataLines) {
    if (line.trim() === '') continue
    const fields = parseCsvLine(line, delimiter).map((f) => f.trim())
    rows.push(fields)
  }

  return { headers, rows }
}
