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

    if (!salaryMonth || !/^\d{4}-\d{2}$/.test(salaryMonth)) {
      return NextResponse.json(
        { error: 'salaryMonth is required and must be in YYYY-MM format' },
        { status: 400 }
      )
    }

    // Determine which companies to reconcile
    let companyIds: string[]

    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })
      if (!company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 })
      }
      companyIds = [companyId]
    } else {
      // Find all companies that have payroll records for this month
      const records = await prisma.payrollRecord.findMany({
        where: { salaryMonth },
        select: { companyId: true },
        distinct: ['companyId'],
      })
      companyIds = records.map((r) => r.companyId)

      if (companyIds.length === 0) {
        return NextResponse.json(
          { error: `No payroll records found for month ${salaryMonth}` },
          { status: 404 }
        )
      }
    }

    // Run reconciliation for each company
    const results = await Promise.all(
      companyIds.map((cid) => runReconciliation(cid, salaryMonth))
    )

    // Aggregate across companies
    const aggregate = {
      salaryMonth,
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
