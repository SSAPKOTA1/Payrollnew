/**
 * temporal-inference.ts
 *
 * Extracts the SALARY MONTH from a German bank transaction's purpose text.
 * The key insight: the transfer DATE is irrelevant — companies often pay May
 * salaries in early June. What matters is what the purpose TEXT says.
 *
 * Handles all real-world German/Austrian/Swiss bank purpose formats:
 *   "Gehalt Mai 2026"              → 2026-05
 *   "Gehalt 05/2026"               → 2026-05
 *   "Gehalt 05.2026"               → 2026-05
 *   "Lohn Mai 26"                  → 2026-05  (2-digit year)
 *   "Salary May 26"                → 2026-05
 *   "salary may 2026"              → 2026-05
 *   "Gehalt 05-2026"               → 2026-05
 *   "Lohn fuer Mai 2026"           → 2026-05
 *   "Gehalt fuer den Monat 05/26"  → 2026-05
 *   "2026-05 Gehalt"               → 2026-05  (month first)
 *   "LOHN/GEHALT 052026"           → 2026-05  (no separator)
 *   "Gehalt Maerz 2026"            → 2026-03  (umlaut variant)
 *   "Entgelt 05.26"                → 2026-05  (2-digit year with dot)
 */

// ---------------------------------------------------------------------------
// Month name tables — covers all German/English variants including umlauts
// ---------------------------------------------------------------------------

const MONTH_NAMES: Array<{ names: string[]; num: number }> = [
  { num: 1,  names: ['januar', 'jan', 'january'] },
  { num: 2,  names: ['februar', 'feb', 'february'] },
  { num: 3,  names: ['maerz', 'marz', 'märz', 'mar', 'march', 'mär'] },
  { num: 4,  names: ['april', 'apr'] },
  { num: 5,  names: ['mai', 'may'] },
  { num: 6,  names: ['juni', 'jun', 'june'] },
  { num: 7,  names: ['juli', 'jul', 'july'] },
  { num: 8,  names: ['august', 'aug'] },
  { num: 9,  names: ['september', 'sept', 'sep'] },
  { num: 10, names: ['oktober', 'okt', 'october', 'oct'] },
  { num: 11, names: ['november', 'nov'] },
  { num: 12, names: ['dezember', 'dez', 'december', 'dec'] },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0')
}

function makeYearMonth(year: number, month: number): string {
  return `${year}-${zeroPad(month)}`
}

function isValidMonth(m: number): boolean {
  return m >= 1 && m <= 12
}

/** Expand 2-digit year to 4-digit (20xx assumed for 00-99) */
function expandYear(y: number): number {
  if (y >= 100) return y
  return y + 2000
}

function isValidExpandedYear(y: number): boolean {
  const full = expandYear(y)
  return full >= 2000 && full <= 2100
}

// ---------------------------------------------------------------------------
// Core extraction — tries patterns in priority order, returns first match
// ---------------------------------------------------------------------------

/**
 * Extract the salary month from a bank transaction purpose string.
 *
 * Returns "YYYY-MM" or null. Does NOT fall back to booking date —
 * callers decide whether to use a booking-date fallback.
 */
export function extractSalaryMonthFromPurpose(purpose: string): string | null {
  if (!purpose || typeof purpose !== 'string') return null

  const text = purpose.trim()

  // ── 1. YYYY-MM  (ISO, unambiguous) ────────────────────────────────────────
  const iso = text.match(/\b(20\d{2})[-](0[1-9]|1[0-2])\b/)
  if (iso) return makeYearMonth(parseInt(iso[1]), parseInt(iso[2]))

  // ── 2. MM/YYYY or MM-YYYY ─────────────────────────────────────────────────
  const slashDash = text.match(/\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/)
  if (slashDash) {
    const m = parseInt(slashDash[1])
    const y = parseInt(slashDash[2])
    if (isValidMonth(m)) return makeYearMonth(y, m)
  }

  // ── 3. MM.YYYY  (e.g. "05.2026") — avoid matching DD.MM.YYYY ──────────────
  const dotFull = [...text.matchAll(/(?<!\d)(0?[1-9]|1[0-2])\.(20\d{2})(?!\d)/g)]
  for (const m of dotFull) {
    const mo = parseInt(m[1])
    const yr = parseInt(m[2])
    if (isValidMonth(mo)) return makeYearMonth(yr, mo)
  }

  // ── 4. MM/YY or MM-YY or MM.YY  (2-digit year) ───────────────────────────
  const shortYear = text.match(/\b(0?[1-9]|1[0-2])[\/\-\.](2[0-9])\b(?!\d)/)
  if (shortYear) {
    const mo = parseInt(shortYear[1])
    const yr = expandYear(parseInt(shortYear[2]))
    if (isValidMonth(mo) && yr >= 2020) return makeYearMonth(yr, mo)
  }

  // ── 5. Month name (German/English) + 4-digit year ─────────────────────────
  //    e.g. "Gehalt Mai 2026", "Salary May 2026", "Lohn Maerz 2026"
  const lower = text.toLowerCase()
  for (const { num, names } of MONTH_NAMES) {
    for (const name of names) {
      // name followed by optional noise then 4-digit year
      const re = new RegExp(`\\b${name}\\b[\\s.,/\\-]*(20\\d{2})\\b`, 'i')
      const match = lower.match(re)
      if (match) {
        const yr = parseInt(match[1])
        return makeYearMonth(yr, num)
      }
    }
  }

  // ── 6. Month name + 2-digit year ──────────────────────────────────────────
  //    e.g. "Gehalt Mai 26", "Salary May 26"
  for (const { num, names } of MONTH_NAMES) {
    for (const name of names) {
      const re = new RegExp(`\\b${name}\\b[\\s.,/\\-]*(2[0-9])\\b`, 'i')
      const match = lower.match(re)
      if (match) {
        const yr = expandYear(parseInt(match[1]))
        if (yr >= 2020) return makeYearMonth(yr, num)
      }
    }
  }

  // ── 7. 4-digit year + month name (reversed order) ─────────────────────────
  //    e.g. "2026 Mai Gehalt"
  for (const { num, names } of MONTH_NAMES) {
    for (const name of names) {
      const re = new RegExp(`\\b(20\\d{2})\\b[\\s.,/\\-]*${name}\\b`, 'i')
      const match = lower.match(re)
      if (match) {
        return makeYearMonth(parseInt(match[1]), num)
      }
    }
  }

  // ── 8. MMYYYY or YYYYMM run together (e.g. "052026" or "202605") ──────────
  //    Seen in some automated bank exports
  const runTogether = text.match(/\b(0[1-9]|1[0-2])(20\d{2})\b/)
  if (runTogether) {
    const mo = parseInt(runTogether[1])
    const yr = parseInt(runTogether[2])
    if (isValidMonth(mo)) return makeYearMonth(yr, mo)
  }
  const runTogetherRev = text.match(/\b(20\d{2})(0[1-9]|1[0-2])\b/)
  if (runTogetherRev) {
    const yr = parseInt(runTogetherRev[1])
    const mo = parseInt(runTogetherRev[2])
    if (isValidMonth(mo)) return makeYearMonth(yr, mo)
  }

  return null
}

/**
 * Infer the salary month from a bank transaction purpose string and booking date.
 *
 * Priority:
 *   1. Explicit month extracted from purpose text (most reliable)
 *   2. Fallback: booking date minus 1 month (salary paid in following month)
 */
export function inferSalaryMonth(purpose: string, bookingDate: Date): string | null {
  const fromPurpose = extractSalaryMonthFromPurpose(purpose)
  if (fromPurpose) return fromPurpose

  // Fallback: assume salary was for the previous calendar month
  if (bookingDate instanceof Date && !isNaN(bookingDate.getTime())) {
    const d = new Date(bookingDate)
    d.setDate(1)
    d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${zeroPad(d.getMonth() + 1)}`
  }

  return null
}
