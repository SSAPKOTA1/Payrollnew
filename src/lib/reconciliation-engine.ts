/**
 * reconciliation-engine.ts
 * Core payroll reconciliation logic: matches payroll records against bank
 * transactions and persists the results.
 */

import { prisma } from './prisma'
import { fuzzyMatchName, matchIban } from './fuzzy-matcher'

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

const WEIGHT_IBAN = 90
const WEIGHT_NAME = 50
const WEIGHT_AMOUNT = 30
const WEIGHT_DATE = 20
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

  // --- Name match (50 pts, fuzzy) ---
  if (payroll.employeeName && tx.counterpartyName) {
    const nameSimilarity = fuzzyMatchName(payroll.employeeName, tx.counterpartyName)
    if (nameSimilarity >= 70) {
      const nameScore = Math.round((nameSimilarity / 100) * WEIGHT_NAME)
      score += nameScore
      notes.push(`Name match: ${nameSimilarity}%`)
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
  // 1. Load payroll records
  // -------------------------------------------------------------------------
  const payrollRows = (await (prisma as any).payrollRecord.findMany({
    where: { companyId, salaryMonth },
  })) as PayrollRow[]

  // -------------------------------------------------------------------------
  // 2. Load bank transactions
  //    We load transactions roughly within the salary month ± 2 months to
  //    catch late or early payments.
  // -------------------------------------------------------------------------
  const [year, month] = salaryMonth.split('-').map(Number)
  const windowStart = new Date(year, month - 2, 1) // 1 month before salary month
  const windowEnd = new Date(year, month + 1, 31) // 1 month after salary month

  const transactions = (await (prisma as any).bankTransaction.findMany({
    where: {
      companyId,
      bookingDate: {
        gte: windowStart,
        lte: windowEnd,
      },
      // Only consider debit transactions (positive outgoing amounts from company)
      amount: { gt: 0 },
    },
  })) as BankTransaction[]

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
    await (prisma as any).reconciliationRecord.upsert({
      where: {
        companyId_salaryMonth_employeeId: {
          companyId: record.companyId,
          salaryMonth: record.salaryMonth,
          employeeId: record.employeeId,
        },
      },
      update: {
        expectedAmount: record.expectedAmount,
        paidAmount: record.paidAmount,
        status: record.status,
        confidence: record.confidence,
        matchedTransactionId: record.matchedTransactionId,
        notes: record.notes,
        updatedAt: new Date(),
      },
      create: {
        companyId: record.companyId,
        salaryMonth: record.salaryMonth,
        employeeId: record.employeeId,
        employeeName: record.employeeName,
        expectedAmount: record.expectedAmount,
        paidAmount: record.paidAmount,
        status: record.status,
        confidence: record.confidence,
        matchedTransactionId: record.matchedTransactionId,
        notes: record.notes,
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
