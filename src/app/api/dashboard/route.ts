import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function monthOffset(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function GET(_request: NextRequest) {
  try {
    const currentMonth = monthOffset(0)

    // 1. Current-month reconciliation status breakdown
    const currentMonthRecon = await prisma.reconciliationRecord.findMany({
      where: { salaryMonth: currentMonth },
      select: { status: true, expectedAmount: true, paidAmount: true },
    })

    let totalPayrollCost = 0
    let paidTotal = 0
    let unpaidTotal = 0
    let partialTotal = 0
    let needsReviewCount = 0

    for (const rec of currentMonthRecon) {
      const expected = Number(rec.expectedAmount)
      totalPayrollCost += expected
      switch (rec.status) {
        case 'PAID':
        case 'OVERPAID':
          paidTotal += Number(rec.paidAmount)
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

    // Fallback if no reconciliation records exist yet
    if (currentMonthRecon.length === 0) {
      const payrollAgg = await prisma.payrollRecord.aggregate({
        where: { salaryMonth: currentMonth },
        _sum: { auszahlungsbetrag: true },
      })
      totalPayrollCost = Number(payrollAgg._sum.auszahlungsbetrag ?? 0)
      unpaidTotal = totalPayrollCost
    }

    const riskAmount = unpaidTotal + partialTotal

    // 2. Per-company summaries
    const companies = await prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const companySummaries = await Promise.all(
      companies.map(async (company) => {
        const [employeeCount, payrollAgg, reconRecords] = await Promise.all([
          prisma.companyEmployee.count({ where: { companyId: company.id, active: true } }),
          prisma.payrollRecord.aggregate({
            where: { companyId: company.id, salaryMonth: currentMonth },
            _sum: { auszahlungsbetrag: true },
          }),
          prisma.reconciliationRecord.findMany({
            where: { companyId: company.id, salaryMonth: currentMonth },
            select: { status: true },
          }),
        ])

        const totalCost = Number(payrollAgg._sum.auszahlungsbetrag ?? 0)
        const paidCount = reconRecords.filter((r) => r.status === 'PAID' || r.status === 'OVERPAID').length
        const unpaidCount = reconRecords.filter((r) => r.status !== 'PAID' && r.status !== 'OVERPAID').length

        return { companyId: company.id, companyName: company.name, employeeCount, totalCost, paidCount, unpaidCount }
      })
    )

    const activeCompanySummaries = companySummaries.filter((s) => s.totalCost > 0 || s.paidCount > 0 || s.unpaidCount > 0)

    // 3. Monthly trends — last 12 months
    const months = Array.from({ length: 12 }, (_, i) => monthOffset(11 - i))

    const monthlyTrends = await Promise.all(
      months.map(async (month) => {
        const [payrollAgg, paidRecon] = await Promise.all([
          prisma.payrollRecord.aggregate({
            where: { salaryMonth: month },
            _sum: { auszahlungsbetrag: true },
          }),
          prisma.reconciliationRecord.findMany({
            where: { salaryMonth: month, status: { in: ['PAID', 'OVERPAID'] } },
            select: { paidAmount: true },
          }),
        ])
        const paidAmount = paidRecon.reduce((sum, r) => sum + Number(r.paidAmount), 0)
        return { month, totalCost: Number(payrollAgg._sum.auszahlungsbetrag ?? 0), paidAmount }
      })
    )

    // 4. Alerts
    type Alert = { type: string; message: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; createdAt: Date }
    const recentAlerts: Alert[] = []

    const unpaidRecords = await prisma.reconciliationRecord.findMany({
      where: { salaryMonth: currentMonth, status: 'UNPAID' },
      take: 5,
      orderBy: { expectedAmount: 'desc' },
      include: { employee: { select: { name: true } } },
    })
    for (const rec of unpaidRecords) {
      recentAlerts.push({
        type: 'UNPAID_SALARY',
        message: `Salary not paid for ${rec.employee.name} in ${currentMonth} (expected: €${Number(rec.expectedAmount).toFixed(2)})`,
        severity: 'HIGH',
        createdAt: rec.updatedAt,
      })
    }

    const reviewRecords = await prisma.reconciliationRecord.findMany({
      where: { salaryMonth: currentMonth, status: 'NEEDS_REVIEW' },
      take: 5,
      orderBy: { updatedAt: 'desc' },
      include: { employee: { select: { name: true } } },
    })
    for (const rec of reviewRecords) {
      recentAlerts.push({
        type: 'NEEDS_REVIEW',
        message: `Reconciliation needs review for ${rec.employee.name} in ${currentMonth}`,
        severity: 'MEDIUM',
        createdAt: rec.updatedAt,
      })
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
    recentAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.createdAt.getTime() - a.createdAt.getTime())

    return NextResponse.json({
      currentMonth,
      totalPayrollCost,
      paidTotal,
      unpaidTotal,
      partialTotal,
      needsReviewCount,
      riskAmount,
      companySummaries: activeCompanySummaries,
      monthlyTrends,
      recentAlerts: recentAlerts.slice(0, 20),
    })
  } catch (error) {
    console.error('[dashboard] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
