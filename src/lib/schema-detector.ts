/**
 * schema-detector.ts
 * Auto-detects whether an uploaded file is a German payroll export or a bank transaction export,
 * and maps source columns to canonical target fields.
 */

import { levenshteinDistance } from './fuzzy-matcher'

export type ColumnMapping = {
  sourceColumn: string
  targetField: string
  confidence: number
}

// ---------------------------------------------------------------------------
// Indicator header sets
// ---------------------------------------------------------------------------

const PAYROLL_INDICATORS = [
  'Pers.-Nr.',
  'Personalnummer',
  'Name',
  'Gesamt-Brutto',
  'Auszahlungsbetrag',
  'Lohnsteuer',
  'KV-Brutto',
  'RV-Brutto',
  'Steuer-Brutto',
  'Brutto',
]

const BANK_INDICATORS = [
  'Buchungstag',
  'Verwendungszweck',
  'Betrag',
  'IBAN',
  'Beguenstigter',
  'Auftragskonto',
  'Waehrung',
  'Buchungstext',
  'Valutadatum',
]

// ---------------------------------------------------------------------------
// Canonical target field -> list of known source column aliases
// ---------------------------------------------------------------------------

const PAYROLL_FIELD_ALIASES: Record<string, string[]> = {
  employee_id: ['Pers.-Nr.', 'Personalnummer', 'employee_id', 'EMP_ID'],
  employee_name: ['Name', 'Mitarbeitername', 'Nachname'],
  gross_salary: ['Gesamt-Brutto', 'Brutto', 'gross_salary', 'Steuer-Brutto'],
  net_salary: ['Auszahlungsbetrag', 'Netto', 'net_salary'],
  salary_month: ['Monat', 'Month', 'salary_month'],
  lohnsteuer: ['Lohnsteuer', 'Income Tax'],
  kv_an: ['KV-Beitrag AN'],
  rv_an: ['RV-Beitrag AN'],
  av_an: ['AV-Beitrag AN'],
  pv_an: ['PV-Beitrag AN'],
  kv_ag: ['KV-Beitrag AG'],
  rv_ag: ['RV-Beitrag AG'],
  av_ag: ['AV-Beitrag AG'],
  pv_ag: ['PV-Beitrag AG'],
  umlage1: ['Umlage 1'],
  umlage2: ['Umlage 2'],
  umlage_insolv: ['Umlage Insolv.'],
}

const BANK_FIELD_ALIASES: Record<string, string[]> = {
  account_iban: ['Auftragskonto'],
  booking_date: ['Buchungstag'],
  value_date: ['Valutadatum'],
  booking_text: ['Buchungstext'],
  purpose: ['Verwendungszweck'],
  counterparty_name: ['Beguenstigter/Zahlungspflichtiger', 'Empfaenger', 'Beguenstigter'],
  counterparty_iban: ['Kontonummer/IBAN', 'IBAN'],
  bic: ['BIC (SWIFT-Code)', 'BIC'],
  amount: ['Betrag', 'Amount'],
  currency: ['Waehrung', 'Currency'],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fuzzy similarity score between two strings (0-100).
 * Uses normalized Levenshtein distance with case-insensitive comparison.
 */
function headerSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()
  if (na === nb) return 100
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 100
  const dist = levenshteinDistance(na, nb)
  return Math.round(Math.max(0, (1 - dist / maxLen) * 100))
}

/**
 * Find the best matching alias for a given source header in an alias list.
 * Returns the highest similarity score (0-100).
 */
function bestAliasScore(sourceHeader: string, aliases: string[]): number {
  let best = 0
  for (const alias of aliases) {
    const score = headerSimilarity(sourceHeader, alias)
    if (score > best) best = score
  }
  return best
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether the file represented by headers+rows is a payroll export,
 * a bank transaction export, or unknown.
 *
 * Returns confidence 0-100.
 */
export function detectFileType(
  headers: string[],
  _rows: any[][]
): { type: 'PAYROLL' | 'BANK_TRANSACTION' | 'UNKNOWN'; confidence: number } {
  const MATCH_THRESHOLD = 60 // minimum similarity to count as a hit

  let payrollHits = 0
  let bankHits = 0

  for (const header of headers) {
    // Count payroll indicator matches
    for (const indicator of PAYROLL_INDICATORS) {
      if (headerSimilarity(header, indicator) >= MATCH_THRESHOLD) {
        payrollHits++
        break // count each header once
      }
    }
    // Count bank indicator matches
    for (const indicator of BANK_INDICATORS) {
      if (headerSimilarity(header, indicator) >= MATCH_THRESHOLD) {
        bankHits++
        break
      }
    }
  }

  const payrollRatio = payrollHits / PAYROLL_INDICATORS.length
  const bankRatio = bankHits / BANK_INDICATORS.length

  const payrollConfidence = Math.round(payrollRatio * 100)
  const bankConfidence = Math.round(bankRatio * 100)

  // Only return UNKNOWN when neither side has any signal at all
  if (payrollHits === 0 && bankHits === 0) {
    return { type: 'UNKNOWN', confidence: 0 }
  }

  if (payrollHits >= bankHits) {
    return { type: 'PAYROLL', confidence: payrollConfidence }
  }

  return { type: 'BANK_TRANSACTION', confidence: bankConfidence }
}

/**
 * Detect column mappings from source headers to canonical target fields.
 *
 * Combines payroll and bank alias maps; the best-confidence mapping wins.
 * Returns only mappings with confidence >= 40.
 */
export function detectColumnMappings(
  headers: string[],
  _rows: any[][]
): ColumnMapping[] {
  // Merge both alias maps — let the best score determine which field wins
  const allAliases: Record<string, string[]> = {
    ...PAYROLL_FIELD_ALIASES,
    ...BANK_FIELD_ALIASES,
  }

  const mappings: ColumnMapping[] = []

  for (const sourceColumn of headers) {
    let bestField: string | null = null
    let bestScore = 0

    for (const [targetField, aliases] of Object.entries(allAliases)) {
      const score = bestAliasScore(sourceColumn, aliases)
      if (score > bestScore) {
        bestScore = score
        bestField = targetField
      }
    }

    if (bestField !== null && bestScore >= 40) {
      mappings.push({
        sourceColumn,
        targetField: bestField,
        confidence: bestScore,
      })
    }
  }

  return mappings
}
