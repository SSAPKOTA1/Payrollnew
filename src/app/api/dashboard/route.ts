/**
 * GET /api/dashboard
 *
 * Executive dashboard data for the current month.
 * Returns aggregate payroll costs, reconciliation status breakdown,
 * per-company summaries, 12-month trends, and recent alerts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/** Returns YYYY-MM string for N months ago from today (0 = current month). */
function monthOffset(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function GET(_request: NextRequest) {
  try {
    // Use the most recent month that has payroll data; fall back to current month
    const latestPayroll = await prisma.payrollRecord.findFirst({
      orderBy: { salaryMonth: 'desc' },
      select: { salaryMonth: true },
    })
    const currentMonth = latestPayroll?.salaryMonth ?? monthOffset(0)

    // -------------------------------------------------------------------------
    // 1. Current-month reconciliation status breakdown
    // -------------------------------------------------------------------------
    const currentMonthRecon = await prisma.reconciliationRecord.findMany({
      where: { salaryMonth: currentMonth },
      select: {
        status: true,
        expectedAmount: true,
        paidAmount: true,
      },
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

    // If no reconciliation records for current month, fall back to payroll records
    if (currentMonthRecon.length === 0) {
      const payrollAgg = await prisma.payrollRecord.aggregate({
        where: { salaryMonth: currentMonth },
        _sum: { auszahlungsbetrag: true },
      })
      totalPayrollCost = Number(payrollAgg._sum.auszahlungsbetrag ?? 0)
      unpaidTotal = totalPayrollCost
    }

    const riskAmount = unpaidTotal + partialTotal

    // -------------------------------------------------------------------------
    // 2. Per-company summaries for current month
    // -------------------------------------------------------------------------
    const companies = await prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const companySummaries = await Promise.all(
      companies.map(async (company) => {
        // Employee count for this company
        const employeeCount = await prisma.companyEmployee.count({
          where: { companyId: company.id, active: true },
        })

        // Payroll total for current month
        const payrollAgg = await prisma.payrollRecord.aggregate({
          where: { companyId: company.id, salaryMonth: currentMonth },
          _sum: { auszahlungsbetrag: true },
          _count: { id: true },
        })

        const totalCost = Number(payrollAgg._sum.auszahlungsbetrag ?? 0)

        // Reconciliation breakdown for this company and month
        const recon = await prisma.reconciliationRecord.groupBy({
          by: ['status'],
          where: { companyId: company.id, salaryMonth: currentMonth },
          _count: { id: true },
        })

        const reconMap = Object.fromEntries(recon.map((r) => [r.status, r._count.id]))
        const paidCount = (reconMap['PAID'] ?? 0) + (reconMap['OVERPAID'] ?? 0)
        const unpaidCount = (reconMap['UNPAID'] ?? 0) + (reconMap['PARTIAL'] ?? 0) + (reconMap['NEEDS_REVIEW'] ?? 0)

        return {
          companyId: company.id,
          companyName: company.name,
          employeeCount,
          totalCost,
          paidCount,
          unpaidCount,
        }
      })
    )

    // Filter to companies that actually have payroll data this month
    const activeCompanySummaries = companySummaries.filter((s) => s.totalCost > 0 || s.paidCount > 0 || s.unpaidCount > 0)

    // -------------------------------------------------------------------------
    // 3. Monthly trends – last 12 months
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
    // 4. Recent alerts
    //    Derive alerts from recent NEEDS_REVIEW / UNPAID records and errors
    // -------------------------------------------------------------------------
    type Alert = {
      type: string
      message: string
      severity: 'HIGH' | 'MEDIUM' | 'LOW'
      createdAt: Date
    }

    const recentAlerts: Alert[] = []

    // High-risk: UNPAID records from current month
    const unpaidRecords = await prisma.reconciliationRecord.findMany({
      where: { salaryMonth: currentMonth, status: 'UNPAID' },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { name: true } },
      },
    })

    for (const rec of unpaidRecords) {
      recentAlerts.push({
        type: 'UNPAID_SALARY',
        message: `Salary not paid for ${rec.employee.name} in ${currentMonth} (expected: €${Number(rec.expectedAmount).toFixed(2)})`,
        severity: 'HIGH',
        createdAt: rec.createdAt,
      })
    }

    // Medium: NEEDS_REVIEW records
    const reviewRecords = await prisma.reconciliationRecord.findMany({
      where: { salaryMonth: currentMonth, status: 'NEEDS_REVIEW' },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { name: true } },
      },
    })

    for (const rec of reviewRecords) {
      recentAlerts.push({
        type: 'NEEDS_REVIEW',
        message: `Reconciliation needs review for ${rec.employee.name} in ${currentMonth}`,
        severity: 'MEDIUM',
        createdAt: rec.createdAt,
      })
    }

    // Low: failed file uploads
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

    // Sort alerts by severity then date
    const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    recentAlerts.sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
      if (sevDiff !== 0) return sevDiff
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

    // -------------------------------------------------------------------------
    // Response
    // -------------------------------------------------------------------------
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
