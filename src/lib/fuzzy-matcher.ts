/**
 * fuzzy-matcher.ts
 * Utilities for name matching, IBAN normalization, and string comparison.
 */

/**
 * Compute the Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

/**
 * Normalize a name for comparison:
 * - Lowercase
 * - German umlauts → ascii equivalents
 * - Strip punctuation except hyphens
 * - Collapse whitespace
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/ae/g, 'ae').replace(/oe/g, 'oe').replace(/ue/g, 'ue')
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split a name into individual tokens, splitting on spaces and commas.
 * e.g. "Aryal, Ramesh" → ["aryal", "ramesh"]
 * e.g. "Ramesh Aryal"  → ["ramesh", "aryal"]
 */
function nameTokens(name: string): string[] {
  return name.split(/[\s,]+/).filter(Boolean)
}

/**
 * Exact name match — both name parts must be present, order doesn't matter.
 *
 * Rules:
 *  - Splits both names into tokens (words)
 *  - Every token in the payroll name must appear exactly in the bank name
 *  - Every token in the bank name must appear exactly in the payroll name
 *  - Order is irrelevant: "Aryal, Ramesh" == "Ramesh Aryal"
 *  - Returns true/false
 *
 * Examples:
 *   exactNameMatch("Aryal, Ramesh", "Ramesh Aryal")     → true
 *   exactNameMatch("Bogati, Umesh Jung", "Umesh Jung Bogati") → true
 *   exactNameMatch("Aryal, Ramesh", "R. Aryal")          → false (abbreviation not accepted)
 *   exactNameMatch("Aryal, Ramesh", "Aryal")              → false (missing first name)
 */
export function exactNameMatch(payrollName: string, bankName: string): boolean {
  const t1 = nameTokens(normalizeName(payrollName))
  const t2 = nameTokens(normalizeName(bankName))

  if (t1.length === 0 || t2.length === 0) return false

  const set1 = new Set(t1)
  const set2 = new Set(t2)

  // All tokens from payroll must be in bank name and vice versa
  for (const t of set1) if (!set2.has(t)) return false
  for (const t of set2) if (!set1.has(t)) return false

  return true
}

/**
 * Fuzzy match — used as fallback when exact match fails.
 * Returns 0-100 score.
 */
export function fuzzyMatchName(name1: string, name2: string): number {
  const n1 = normalizeName(name1)
  const n2 = normalizeName(name2)

  if (n1 === n2) return 100

  // Try exact token match first
  if (exactNameMatch(name1, name2)) return 100

  const tokens1 = nameTokens(n1)
  const tokens2 = nameTokens(n2)

  let matched = 0
  const usedB = new Set<number>()

  for (const ta of tokens1) {
    let bestScore = 0
    let bestIdx = -1
    for (let i = 0; i < tokens2.length; i++) {
      if (usedB.has(i)) continue
      const tb = tokens2[i]
      const maxLen = Math.max(ta.length, tb.length)
      const score = maxLen > 0 ? Math.max(0, 1 - levenshteinDistance(ta, tb) / maxLen) : 0
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    if (bestScore > 0.5) { matched += bestScore; if (bestIdx >= 0) usedB.add(bestIdx) }
  }

  const maxTokens = Math.max(tokens1.length, tokens2.length)
  return Math.round((matched / maxTokens) * 100)
}

/**
 * Remove spaces and convert to uppercase for IBAN comparison.
 */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase()
}

/**
 * Compare two IBANs for equality after normalization.
 */
export function matchIban(iban1: string, iban2: string): boolean {
  return normalizeIban(iban1) === normalizeIban(iban2)
}
