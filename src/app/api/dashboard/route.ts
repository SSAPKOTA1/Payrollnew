/**
 * GET /api/dashboard
 *
 * Executive dashboard. Each company shows its own latest salary month —
 * so Company A may show May 2026 while Company B shows April 2026.
 * KPI cards aggregate across all companies' latest months combined.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function monthOffset(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const selectedMonth = searchParams.get('month') ?? null

    // -------------------------------------------------------------------------
    // 0. Collect all available months (for the month picker dropdown)
    // -------------------------------------------------------------------------
    const allMonthRows = await prisma.payrollRecord.findMany({
      select: { salaryMonth: true },
      distinct: ['salaryMonth'],
      orderBy: { salaryMonth: 'desc' },
    })
    const availableMonths = allMonthRows.map((r) => r.salaryMonth)

    // -------------------------------------------------------------------------
    // 1. Determine which month to show per company
    //    - If user selected a month: use that month for all companies
    //    - Otherwise: each company uses its own latest month
    // -------------------------------------------------------------------------
    const companies = await prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const companyLatestMonths = await Promise.all(
      companies.map(async (company) => {
        if (selectedMonth) {
          // Only include company if it has data for the selected month
          const exists = await prisma.payrollRecord.findFirst({
            where: { companyId: company.id, salaryMonth: selectedMonth },
            select: { salaryMonth: true },
          })
          return { company, latestMonth: exists ? selectedMonth : null }
        } else {
          const latest = await prisma.payrollRecord.findFirst({
            where: { companyId: company.id },
            orderBy: { salaryMonth: 'desc' },
            select: { salaryMonth: true },
          })
          return { company, latestMonth: latest?.salaryMonth ?? null }
        }
      })
    )

    const activeCompanyMonths = companyLatestMonths.filter((c) => c.latestMonth !== null)

    const monthCounts = new Map<string, number>()
    for (const { latestMonth } of activeCompanyMonths) {
      if (latestMonth) monthCounts.set(latestMonth, (monthCounts.get(latestMonth) ?? 0) + 1)
    }
    const headlineMonth =
      selectedMonth ??
      [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      monthOffset(0)

    // -------------------------------------------------------------------------
    // 2. Per-company summaries — each uses its own latest month
    // -------------------------------------------------------------------------
    const companySummaries = await Promise.all(
      activeCompanyMonths.map(async ({ company, latestMonth }) => {
        const month = latestMonth!

        const [employeeCount, payrollAgg, recon] = await Promise.all([
          prisma.companyEmployee.count({ where: { companyId: company.id, active: true } }),
          prisma.payrollRecord.aggregate({
            where: { companyId: company.id, salaryMonth: month },
            _sum: { auszahlungsbetrag: true },
            _count: { id: true },
          }),
          prisma.reconciliationRecord.groupBy({
            by: ['status'],
            where: { companyId: company.id, salaryMonth: month },
            _count: { id: true },
          }),
        ])

        const totalCost = Number(payrollAgg._sum.auszahlungsbetrag ?? 0)
        const reconMap = Object.fromEntries(recon.map((r) => [r.status, r._count.id]))
        const paidCount = (reconMap['PAID'] ?? 0) + (reconMap['OVERPAID'] ?? 0)
        const unpaidCount =
          (reconMap['UNPAID'] ?? 0) + (reconMap['PARTIAL'] ?? 0) + (reconMap['NEEDS_REVIEW'] ?? 0)
        const totalEmployees = payrollAgg._count.id

        return {
          companyId: company.id,
          companyName: company.name,
          salaryMonth: month,
          employeeCount,
          totalEmployees,
          totalCost,
          paidCount,
          unpaidCount,
        }
      })
    )

    // -------------------------------------------------------------------------
    // 3. KPI totals — aggregate across all companies' latest month data
    // -------------------------------------------------------------------------
    // Collect all (companyId, latestMonth) pairs
    const monthPairs = activeCompanyMonths
      .filter((c) => c.latestMonth)
      .map((c) => ({ companyId: c.company.id, salaryMonth: c.latestMonth! }))

    let totalPayrollCost = 0
    let paidTotal = 0
    let unpaidTotal = 0
    let partialTotal = 0
    let needsReviewCount = 0

    for (const { companyId, salaryMonth } of monthPairs) {
      const reconRows = await prisma.reconciliationRecord.findMany({
        where: { companyId, salaryMonth },
        select: { status: true, expectedAmount: true, paidAmount: true },
      })

      if (reconRows.length > 0) {
        for (const rec of reconRows) {
          const expected = Number(rec.expectedAmount)
          totalPayrollCost += expected
          switch (rec.status) {
            case 'PAID':
            case 'OVERPAID':
              paidTotal += Number(rec.paidAmount ?? expected)
              break
            case 'UNPAID':
              unpaidTotal += expected
              break
            case 'PARTIAL':
              partialTotal += expected
              break
            case 'NEEDS_REVIEW':
              needsReviewCount++
              break
          }
        }
      } else {
        // No reconciliation yet — count as unpaid
        const agg = await prisma.payrollRecord.aggregate({
          where: { companyId, salaryMonth },
          _sum: { auszahlungsbetrag: true },
        })
        const cost = Number(agg._sum.auszahlungsbetrag ?? 0)
        totalPayrollCost += cost
        unpaidTotal += cost
      }
    }

    const riskAmount = unpaidTotal + partialTotal

    // -------------------------------------------------------------------------
    // 4. Monthly trends – last 12 months (global, all companies)
    // -------------------------------------------------------------------------
    const months = Array.from({ length: 12 }, (_, i) => monthOffset(11 - i))

    const monthlyTrends = await Promise.all(
      months.map(async (month) => {
        const [payrollAgg, reconAgg] = await Promise.all([
          prisma.payrollRecord.aggregate({
            where: { salaryMonth: month },
            _sum: { auszahlungsbetrag: true },
          }),
          prisma.reconciliationRecord.aggregate({
            where: { salaryMonth: month, status: { in: ['PAID', 'OVERPAID'] } },
            _sum: { paidAmount: true },
          }),
        ])
        return {
          month,
          totalCost: Number(payrollAgg._sum.auszahlungsbetrag ?? 0),
          paidAmount: Number(reconAgg._sum.paidAmount ?? 0),
        }
      })
    )

    // -------------------------------------------------------------------------
    // 5. Recent alerts — pull UNPAID/NEEDS_REVIEW from each company's latest month
    // -------------------------------------------------------------------------
    type Alert = {
      type: string
      message: string
      severity: 'HIGH' | 'MEDIUM' | 'LOW'
      createdAt: Date
    }

    const recentAlerts: Alert[] = []

    for (const { companyId, salaryMonth } of monthPairs) {
      const unpaidRecords = await prisma.reconciliationRecord.findMany({
        where: { companyId, salaryMonth, status: 'UNPAID' },
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: { employee: { select: { name: true } } },
      })
      for (const rec of unpaidRecords) {
        recentAlerts.push({
          type: 'UNPAID_SALARY',
          message: `Salary not paid: ${rec.employee.name} — ${salaryMonth} (€${Number(rec.expectedAmount).toFixed(2)})`,
          severity: 'HIGH',
          createdAt: rec.createdAt,
        })
      }

      const reviewRecords = await prisma.reconciliationRecord.findMany({
        where: { companyId, salaryMonth, status: 'NEEDS_REVIEW' },
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: { employee: { select: { name: true } } },
      })
      for (const rec of reviewRecords) {
        recentAlerts.push({
          type: 'NEEDS_REVIEW',
          message: `Needs review: ${rec.employee.name} — ${salaryMonth}`,
          severity: 'MEDIUM',
          createdAt: rec.createdAt,
        })
      }
    }

    const failedFiles = await prisma.uploadedFile.findMany({
      where: { status: 'ERROR' },
      take: 3,
      orderBy: { uploadedAt: 'desc' },
      select: { originalName: true, errorMessage: true, uploadedAt: true },
    })
    for (const f of failedFiles) {
      recentAlerts.push({
        type: 'FILE_ERROR',
        message: `File upload failed: ${f.originalName}${f.errorMessage ? ` — ${f.errorMessage}` : ''}`,
        severity: 'LOW',
        createdAt: f.uploadedAt,
      })
    }

    const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    recentAlerts.sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
      if (sevDiff !== 0) return sevDiff
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

    return NextResponse.json({
      currentMonth: headlineMonth,
      availableMonths,
      totalPayrollCost,
      paidTotal,
      unpaidTotal,
      partialTotal,
      needsReviewCount,
      riskAmount,
      companySummaries,
      monthlyTrends,
      recentAlerts: recentAlerts.slice(0, 20),
    })
  } catch (error) {
    console.error('[dashboard] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
