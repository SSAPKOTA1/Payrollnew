/**
 * GET /api/companies/[id]
 *
 * Return full company detail including:
 *   - Basic company info
 *   - All linked employees
 *   - Payroll summary grouped by salary month
 *   - Reconciliation status summary for the latest month
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        employees: {
          include: {
            employee: {
              select: { id: true, name: true, employeeId: true, iban: true },
            },
          },
          where: { active: true },
        },
      },
    })

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // Payroll summary grouped by month
    const payrollGroups = await prisma.payrollRecord.groupBy({
      by: ['salaryMonth'],
      where: { companyId: id },
      _count: { id: true },
      _sum: { grossSalary: true, netSalary: true, auszahlungsbetrag: true },
      orderBy: { salaryMonth: 'desc' },
    })

    // Latest month reconciliation summary
    const latestMonth = payrollGroups[0]?.salaryMonth ?? null
    let reconciliationSummary: Record<string, number> = {}

    if (latestMonth) {
      const recon = await prisma.reconciliationRecord.groupBy({
        by: ['status'],
        where: {
          salaryMonth: latestMonth,
          payrollRecord: { companyId: id },
        },
        _count: { id: true },
      })
      reconciliationSummary = Object.fromEntries(recon.map((r) => [r.status, r._count.id]))
    }

    return NextResponse.json({
      id: company.id,
      name: company.name,
      shortName: company.shortName,
      iban: company.iban,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      employees: company.employees.map((ce) => ({
        id: ce.employee.id,
        name: ce.employee.name,
        employeeId: ce.employee.employeeId,
        iban: ce.employee.iban,
        startDate: ce.startDate,
        endDate: ce.endDate,
        active: ce.active,
      })),
      payrollSummary: payrollGroups.map((g) => ({
        salaryMonth: g.salaryMonth,
        employeeCount: g._count.id,
        totalGross: Number(g._sum.grossSalary ?? 0),
        totalNet: Number(g._sum.netSalary ?? 0),
        totalPayout: Number(g._sum.auszahlungsbetrag ?? 0),
      })),
      latestMonth,
      reconciliationSummary,
    })
  } catch (error) {
    console.error('[companies/id] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch company' }, { status: 500 })
  }
}
