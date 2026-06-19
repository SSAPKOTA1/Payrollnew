/**
 * temporal-inference.ts
 * Infers the salary month referenced in a bank transaction's purpose text
 * or falls back to booking-date-minus-one-month.
 */

// ---------------------------------------------------------------------------
// German month name map (lowercase key -> month number 1-12)
// ---------------------------------------------------------------------------

const GERMAN_MONTH_NAMES: Record<string, number> = {
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
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
  december: 12,
  dec: 12,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0')
}

function makeYearMonth(year: number, month: number): string {
  return `${year}-${zeroPad(month)}`
}

function isValidMonth(month: number): boolean {
  return month >= 1 && month <= 12
}

function isValidYear(year: number): boolean {
  return year >= 2000 && year <= 2100
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Infer the salary month from a bank transaction purpose string and booking date.
 *
 * Detection priority:
 *   1. ISO numeric: YYYY-MM  (e.g. "Salary 2026-05")
 *   2. MM/YYYY              (e.g. "Gehalt 05/2026")
 *   3. MM.YYYY              (e.g. "Lohn 05.2026")
 *   4. German/English month name + year
 *      (e.g. "Gehalt Mai 2026", "Lohn Januar 2025", "Salary June 2026")
 *   5. Fallback: bookingDate minus 1 month
 *
 * Returns a "YYYY-MM" string, or null if neither purpose nor bookingDate
 * yields a usable result.
 */
export function inferSalaryMonth(purpose: string, bookingDate: Date): string | null {
  // -------------------------------------------------------------------------
  // 1. ISO format: YYYY-MM
  // -------------------------------------------------------------------------
  const isoMatch = purpose.match(/\b(\d{4})-(\d{2})\b/)
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10)
    const month = parseInt(isoMatch[2], 10)
    if (isValidYear(year) && isValidMonth(month)) {
      return makeYearMonth(year, month)
    }
  }

  // -------------------------------------------------------------------------
  // 2. MM/YYYY
  // -------------------------------------------------------------------------
  const slashMatch = purpose.match(/\b(\d{1,2})\/(\d{4})\b/)
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10)
    const year = parseInt(slashMatch[2], 10)
    if (isValidYear(year) && isValidMonth(month)) {
      return makeYearMonth(year, month)
    }
  }

  // -------------------------------------------------------------------------
  // 3. MM.YYYY — must not be preceded by digits to avoid matching DD.MM.YYYY
  //    We look for a boundary before the month digits.
  // -------------------------------------------------------------------------
  // Strategy: scan all MM.YYYY-shaped tokens
  const dotMatches = [...purpose.matchAll(/(?<!\d)(\d{1,2})\.(\d{4})(?!\d)/g)]
  for (const m of dotMatches) {
    const month = parseInt(m[1], 10)
    const year = parseInt(m[2], 10)
    if (isValidYear(year) && isValidMonth(month)) {
      return makeYearMonth(year, month)
    }
  }

  // -------------------------------------------------------------------------
  // 4. German/English month name + year
  //    e.g. "Gehalt Mai 2026", "Lohn Januar 2025", "Salary June 2026"
  // -------------------------------------------------------------------------
  const lowerPurpose = purpose.toLowerCase()

  for (const [monthName, monthNum] of Object.entries(GERMAN_MONTH_NAMES)) {
    // Allow separators: space, comma, slash, dot, hyphen between name and year
    const regex = new RegExp(
      `\\b${monthName}\\b[\\s.,/\\-]*(\\d{4})\\b`,
      'i'
    )
    const match = lowerPurpose.match(regex)
    if (match) {
      const year = parseInt(match[1], 10)
      if (isValidYear(year)) {
        return makeYearMonth(year, monthNum)
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Fallback: bookingDate minus 1 month
  // -------------------------------------------------------------------------
  if (bookingDate instanceof Date && !isNaN(bookingDate.getTime())) {
    const d = new Date(bookingDate)
    // Set to first of the month to avoid day-overflow edge cases
    d.setDate(1)
    d.setMonth(d.getMonth() - 1)
    return makeYearMonth(d.getFullYear(), d.getMonth() + 1)
  }

  return null
}
