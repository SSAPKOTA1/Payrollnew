/**
 * reconciliation-engine.ts
 * Core payroll reconciliation logic: matches payroll records against bank
 * transactions and persists the results.
 */

import { prisma } from './prisma'
import { exactNameMatch, fuzzyMatchName, matchIban } from './fuzzy-matcher'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconciliationStatus =
  | 'PAID'
  | 'PARTIAL'
  | 'OVERPAID'
  | 'UNPAID'
  | 'NEEDS_REVIEW'

export type ReconciliationRecord = {
  id?: string
  companyId: string
  salaryMonth: string
  employeeId: string
  employeeName: string
  expectedAmount: number
  paidAmount: number
  status: ReconciliationStatus
  confidence: number
  matchedTransactionId: string | null
  notes: string[]
}

export type ReconciliationResult = {
  companyId: string
  salaryMonth: string
  totalEmployees: number
  matched: number
  partial: number
  overpaid: number
  unpaid: number
  needsReview: number
  records: ReconciliationRecord[]
}

// ---------------------------------------------------------------------------
// Internal types for DB rows (typed loosely — adapt to your Prisma schema)
// ---------------------------------------------------------------------------

type PayrollRow = {
  id: string
  companyId: string
  salaryMonth: string
  employeeId: string
  employeeName: string
  netSalary: number
  iban?: string | null
}

type BankTransaction = {
  id: string
  companyId: string
  salaryMonth?: string | null
  counterpartyName?: string | null
  counterpartyIban?: string | null
  amount: number
  bookingDate: Date
  purpose?: string | null
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

// Exact name match is the primary signal (no IBAN data in typical payroll files)
const WEIGHT_IBAN   = 90
const WEIGHT_NAME   = 80   // raised — exact name match is very reliable
const WEIGHT_AMOUNT = 30
const WEIGHT_DATE   = 20
const MAX_SCORE = WEIGHT_IBAN + WEIGHT_NAME + WEIGHT_AMOUNT + WEIGHT_DATE

/**
 * Determine how many days apart two dates are.
 */
function daysDiff(a: Date, b: Date): number {
  return Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Parse "YYYY-MM" into a Date pointing to the first of that month.
 */
function salaryMonthToDate(salaryMonth: string): Date {
  const [year, month] = salaryMonth.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

interface ScoreResult {
  score: number
  notes: string[]
}

/**
 * Score a payroll record against a bank transaction.
 * Returns a composite score 0-MAX_SCORE and human-readable notes.
 */
function scoreMatch(
  payroll: PayrollRow,
  tx: BankTransaction,
  salaryMonthDate: Date
): ScoreResult {
  let score = 0
  const notes: string[] = []

  // --- IBAN match (90 pts) ---
  if (payroll.iban && tx.counterpartyIban) {
    if (matchIban(payroll.iban, tx.counterpartyIban)) {
      score += WEIGHT_IBAN
      notes.push('IBAN matched')
    }
  }

  // --- Name match (80 pts) ---
  // Exact match: all name tokens must be present in both names (order-insensitive).
  // e.g. "Aryal, Ramesh" matches "Ramesh Aryal" but NOT "R. Aryal".
  if (payroll.employeeName && tx.counterpartyName) {
    if (exactNameMatch(payroll.employeeName, tx.counterpartyName)) {
      score += WEIGHT_NAME
      notes.push('Name matched exactly')
    } else {
      // Partial credit only for high fuzzy similarity (≥85%) — catches minor typos in bank data
      const nameSimilarity = fuzzyMatchName(payroll.employeeName, tx.counterpartyName)
      if (nameSimilarity >= 85) {
        const nameScore = Math.round((nameSimilarity / 100) * WEIGHT_NAME * 0.6)
        score += nameScore
        notes.push(`Name close match: ${nameSimilarity}%`)
      }
    }
  }

  // --- Amount match (30 pts) ---
  const amountTolerance = payroll.netSalary * 0.01 // 1% tolerance
  const amountDiff = Math.abs(tx.amount - payroll.netSalary)
  if (amountDiff <= amountTolerance) {
    score += WEIGHT_AMOUNT
    notes.push('Amount matched within 1%')
  } else if (amountDiff <= payroll.netSalary * 0.05) {
    // Partial credit for close amounts (within 5%)
    const partialAmountScore = Math.round(
      WEIGHT_AMOUNT * (1 - amountDiff / payroll.netSalary)
    )
    score += partialAmountScore
    notes.push(`Amount close: diff=${amountDiff.toFixed(2)}`)
  }

  // --- Date proximity (20 pts) ---
  // Salary is typically paid in the month of or shortly after the salary month.
  // We give full points if within 45 days.
  const days = daysDiff(tx.bookingDate, salaryMonthDate)
  if (days <= 45) {
    const dateScore = Math.round(WEIGHT_DATE * (1 - days / 45))
    score += dateScore
    notes.push(`Date proximity: ${Math.round(days)} days from salary month`)
  }

  return { score, notes }
}

/**
 * Convert a raw score (0-MAX_SCORE) to a 0-100 confidence value.
 */
function toConfidence(score: number): number {
  return Math.min(100, Math.round((score / MAX_SCORE) * 100))
}

// ---------------------------------------------------------------------------
// Status determination
// ---------------------------------------------------------------------------

function determineStatus(
  confidence: number,
  paidAmount: number,
  expectedAmount: number
): ReconciliationStatus {
  if (confidence === 0 || paidAmount === 0) return 'UNPAID'

  const tolerance = expectedAmount * 0.01 // 1%

  if (confidence < 70) return 'NEEDS_REVIEW'

  if (Math.abs(paidAmount - expectedAmount) <= tolerance) return 'PAID'

  if (paidAmount > expectedAmount + tolerance) return 'OVERPAID'

  if (paidAmount < expectedAmount - tolerance) return 'PARTIAL'

  return 'PAID'
}

// ---------------------------------------------------------------------------
// Main reconciliation function
// ---------------------------------------------------------------------------

/**
 * Run reconciliation for a company and salary month.
 *
 * Steps:
 *  1. Load payroll records from DB
 *  2. Load bank transactions for that company/month
 *  3. Greedy best-match assignment (highest score wins)
 *  4. Determine status for each payroll record
 *  5. Upsert ReconciliationRecord rows
 *  6. Return aggregated summary
 */
export async function runReconciliation(
  companyId: string,
  salaryMonth: string
): Promise<ReconciliationResult> {
  // -------------------------------------------------------------------------
  // 1. Load payroll records (join employee for name + IBAN)
  // -------------------------------------------------------------------------
  const rawPayroll = await prisma.payrollRecord.findMany({
    where: { companyId, salaryMonth },
    include: { employee: { select: { name: true, iban: true } } },
  })

  const payrollRows: PayrollRow[] = rawPayroll.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    salaryMonth: r.salaryMonth,
    employeeId: r.employeeId,
    employeeName: r.employee.name,
    netSalary: Number(r.auszahlungsbetrag),
    iban: r.employee.iban ?? null,
  }))

  // -------------------------------------------------------------------------
  // 2. Load bank transactions (±2 months around the salary month)
  // -------------------------------------------------------------------------
  const [year, month] = salaryMonth.split('-').map(Number)
  const windowStart = new Date(year, month - 2, 1)
  const windowEnd = new Date(year, month + 1, 31)

  // Salary payments leave the company account as debits (negative amounts).
  // Also accept positive amounts as a fallback (some export formats invert sign).
  const rawTransactions = await prisma.bankTransaction.findMany({
    where: {
      companyId,
      bookingDate: { gte: windowStart, lte: windowEnd },
      amount: { not: 0 },
    },
  }) as unknown as BankTransaction[]

  // Normalise to positive amounts so scoring works uniformly.
  // Filter out large incoming transfers (credits that are far larger than any
  // plausible individual salary — they are revenue, not payroll).
  const transactions: BankTransaction[] = rawTransactions
    .map((tx) => ({ ...tx, amount: Math.abs(tx.amount) }))

  // -------------------------------------------------------------------------
  // 3. Score all payroll x transaction combinations
  // -------------------------------------------------------------------------
  const salaryMonthDate = salaryMonthToDate(salaryMonth)

  // Build score matrix: payrollIdx -> { txIdx, score, notes }[]
  type Candidate = { txIdx: number; score: number; notes: string[] }
  const scoreMatrix: Candidate[][] = payrollRows.map((payroll) =>
    transactions
      .map((tx, txIdx) => {
        const { score, notes } = scoreMatch(payroll, tx, salaryMonthDate)
        return { txIdx, score, notes }
      })
      .sort((a, b) => b.score - a.score)
  )

  // Greedy assignment: assign the best available transaction to each payroll record
  const assignedTxIndices = new Set<number>()
  const assignments: Array<{
    payrollIdx: number
    txIdx: number
    score: number
    notes: string[]
  }> = []

  // Sort payroll records by their best score descending to minimize conflicts
  const payrollOrder = payrollRows
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (scoreMatrix[b][0]?.score ?? 0) - (scoreMatrix[a][0]?.score ?? 0)
    )

  for (const payrollIdx of payrollOrder) {
    const candidates = scoreMatrix[payrollIdx]
    const best = candidates.find((c) => !assignedTxIndices.has(c.txIdx))
    if (best && best.score > 0) {
      assignments.push({ payrollIdx, txIdx: best.txIdx, score: best.score, notes: best.notes })
      assignedTxIndices.add(best.txIdx)
    } else {
      assignments.push({ payrollIdx, txIdx: -1, score: 0, notes: ['No matching transaction found'] })
    }
  }

  // -------------------------------------------------------------------------
  // 4. Build reconciliation records and determine status
  // -------------------------------------------------------------------------
  const records: ReconciliationRecord[] = []

  for (const { payrollIdx, txIdx, score, notes } of assignments) {
    const payroll = payrollRows[payrollIdx]
    const tx = txIdx >= 0 ? transactions[txIdx] : null
    const confidence = toConfidence(score)
    const paidAmount = tx ? tx.amount : 0

    const status = determineStatus(confidence, paidAmount, payroll.netSalary)

    records.push({
      companyId,
      salaryMonth,
      employeeId: payroll.employeeId,
      employeeName: payroll.employeeName,
      expectedAmount: payroll.netSalary,
      paidAmount,
      status,
      confidence,
      matchedTransactionId: tx ? tx.id : null,
      notes,
    })
  }

  // -------------------------------------------------------------------------
  // 5. Upsert ReconciliationRecord rows
  // -------------------------------------------------------------------------
  for (const record of records) {
    const sharedData = {
      expectedAmount: record.expectedAmount,
      paidAmount: record.paidAmount,
      status: record.status,
      matchConfidence: record.confidence,
      matchReasons: record.notes as any,
      notes: record.notes.join('; ') || null,
      payrollRecordId: record.matchedTransactionId ? undefined : undefined,
      bankTransactionId: record.matchedTransactionId ?? undefined,
    }

    await prisma.reconciliationRecord.upsert({
      where: {
        companyId_salaryMonth_employeeId: {
          companyId: record.companyId,
          salaryMonth: record.salaryMonth,
          employeeId: record.employeeId,
        },
      },
      update: sharedData,
      create: {
        companyId: record.companyId,
        salaryMonth: record.salaryMonth,
        employeeId: record.employeeId,
        ...sharedData,
      },
    })
  }

  // -------------------------------------------------------------------------
  // 6. Aggregate and return summary
  // -------------------------------------------------------------------------
  const matched = records.filter((r) => r.status === 'PAID').length
  const partial = records.filter((r) => r.status === 'PARTIAL').length
  const overpaid = records.filter((r) => r.status === 'OVERPAID').length
  const unpaid = records.filter((r) => r.status === 'UNPAID').length
  const needsReview = records.filter((r) => r.status === 'NEEDS_REVIEW').length

  return {
    companyId,
    salaryMonth,
    totalEmployees: payrollRows.length,
    matched,
    partial,
    overpaid,
    unpaid,
    needsReview,
    records,
  }
}
