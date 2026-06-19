/**
 * fuzzy-matcher.ts
 * Utilities for fuzzy string matching, IBAN normalization, and name comparison.
 */

/**
 * Compute the Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length

  // Allocate a (m+1) x (n+1) matrix
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
 * Normalize a German name string:
 * - Lowercase
 * - Replace umlauts: ae->ä, oe->ö, ue->ü (and reverse)
 * - Trim extra whitespace
 */
function normalizeGermanName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split a full name into tokens (words), filtering empty strings.
 */
function nameTokens(name: string): string[] {
  return name.split(/[\s,]+/).filter(Boolean)
}

/**
 * Check whether token b is an abbreviation of token a:
 * e.g. "J." matches "John", "M." matches "Mueller"
 */
function isAbbreviation(abbreviated: string, full: string): boolean {
  if (abbreviated.endsWith('.') && abbreviated.length === 2) {
    return full.startsWith(abbreviated[0])
  }
  if (abbreviated.length === 1) {
    return full.startsWith(abbreviated)
  }
  return false
}

/**
 * Score two token arrays against each other, allowing abbreviation matches.
 * Returns a value 0-1.
 */
function scoreTokenSets(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  let matched = 0
  const usedB = new Set<number>()

  for (const ta of tokensA) {
    let bestScore = 0
    let bestIdx = -1

    for (let i = 0; i < tokensB.length; i++) {
      if (usedB.has(i)) continue
      const tb = tokensB[i]

      let score = 0
      if (ta === tb) {
        score = 1
      } else if (isAbbreviation(ta, tb) || isAbbreviation(tb, ta)) {
        score = 0.8
      } else {
        const maxLen = Math.max(ta.length, tb.length)
        if (maxLen > 0) {
          const dist = levenshteinDistance(ta, tb)
          score = Math.max(0, 1 - dist / maxLen)
        }
      }

      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestScore > 0.5) {
      matched += bestScore
      if (bestIdx >= 0) usedB.add(bestIdx)
    }
  }

  // Normalize by the larger set
  const maxTokens = Math.max(tokensA.length, tokensB.length)
  return matched / maxTokens
}

/**
 * Fuzzy match two person names, returning a score 0-100.
 *
 * Handles:
 * - Reversed name order (Smith John vs John Smith)
 * - Abbreviations (J. Smith)
 * - German umlauts (ae->ä normalization)
 * - Case insensitive comparison
 */
export function fuzzyMatchName(name1: string, name2: string): number {
  const n1 = normalizeGermanName(name1)
  const n2 = normalizeGermanName(name2)

  if (n1 === n2) return 100

  const tokens1 = nameTokens(n1)
  const tokens2 = nameTokens(n2)

  // Try forward match
  const forwardScore = scoreTokenSets(tokens1, tokens2)

  // Try reversed tokens for name1
  const reversedTokens1 = [...tokens1].reverse()
  const reverseScore = scoreTokenSets(reversedTokens1, tokens2)

  const best = Math.max(forwardScore, reverseScore)
  return Math.round(best * 100)
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
