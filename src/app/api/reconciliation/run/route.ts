/**
 * POST /api/reconciliation/run
 *
 * Run the reconciliation engine for a given company and salary month.
 * Body: { companyId?: string, salaryMonth: string }  (salaryMonth: "YYYY-MM")
 *
 * If companyId is omitted, runs reconciliation for ALL companies that have
 * payroll records for that month and aggregates the results.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runReconciliation } from '@/lib/reconciliation-engine'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { companyId, salaryMonth } = body as {
      companyId?: string
      salaryMonth?: string
    }

    const runAll = !salaryMonth

    // Collect all (companyId, salaryMonth) pairs to reconcile
    let pairs: { companyId: string; salaryMonth: string }[]

    if (runAll) {
      // Run for every company+month that has payroll data and bank transactions
      const payrollMonths = await prisma.payrollRecord.findMany({
        select: { companyId: true, salaryMonth: true },
        distinct: ['companyId', 'salaryMonth'],
      })
      // Only include pairs where the company also has bank transactions
      const bankCompanyIds = (
        await prisma.bankTransaction.findMany({
          select: { companyId: true },
          distinct: ['companyId'],
        })
      ).map((r) => r.companyId)
      const bankSet = new Set(bankCompanyIds)
      pairs = payrollMonths.filter((p) => bankSet.has(p.companyId))
    } else if (salaryMonth && /^\d{4}-\d{2}$/.test(salaryMonth)) {
      if (companyId) {
        pairs = [{ companyId, salaryMonth }]
      } else {
        const records = await prisma.payrollRecord.findMany({
          where: { salaryMonth },
          select: { companyId: true },
          distinct: ['companyId'],
        })
        pairs = records.map((r) => ({ companyId: r.companyId, salaryMonth }))
      }
    } else {
      return NextResponse.json(
        { error: 'Provide salaryMonth (YYYY-MM) or omit it to reconcile all months' },
        { status: 400 }
      )
    }

    if (pairs.length === 0) {
      return NextResponse.json({ error: 'No payroll+bank data found to reconcile' }, { status: 404 })
    }

    // Run reconciliation sequentially to avoid DB contention
    const results = []
    for (const { companyId: cId, salaryMonth: sm } of pairs) {
      results.push(await runReconciliation(cId, sm))
    }

    // Aggregate across companies
    const aggregate = {
      salaryMonth: salaryMonth ?? 'all',
      companiesProcessed: results.length,
      totalEmployees: results.reduce((s, r) => s + r.totalEmployees, 0),
      matched: results.reduce((s, r) => s + r.matched, 0),
      partial: results.reduce((s, r) => s + r.partial, 0),
      overpaid: results.reduce((s, r) => s + r.overpaid, 0),
      unpaid: results.reduce((s, r) => s + r.unpaid, 0),
      needsReview: results.reduce((s, r) => s + r.needsReview, 0),
      companyResults: results,
    }

    return NextResponse.json(aggregate)
  } catch (error) {
    console.error('[reconciliation/run] POST error:', error)
    return NextResponse.json(
      { error: 'Reconciliation failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
