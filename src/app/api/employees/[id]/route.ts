import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        companies: {
          include: { company: { select: { id: true, name: true, shortName: true, iban: true } } },
        },
        payrollRecords: {
          orderBy: { salaryMonth: 'desc' },
          include: { company: { select: { id: true, name: true, shortName: true } } },
        },
        reconciliations: {
          orderBy: { salaryMonth: 'desc' },
        },
      },
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // Build per-month aggregation across all companies
    const monthMap = new Map<string, { expected: number; paid: number; companies: string[] }>()
    for (const pr of employee.payrollRecords) {
      const existing = monthMap.get(pr.salaryMonth) ?? { expected: 0, paid: 0, companies: [] }
      existing.expected += Number(pr.netSalary)
      if (!existing.companies.includes(pr.companyId)) existing.companies.push(pr.companyId)
      monthMap.set(pr.salaryMonth, existing)
    }
    for (const rec of employee.reconciliations) {
      const existing = monthMap.get(rec.salaryMonth)
      if (existing) existing.paid += Number(rec.paidAmount)
    }

    return NextResponse.json({
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      iban: employee.iban,
      taxClass: employee.taxClass,
      createdAt: employee.createdAt,
      companies: employee.companies.map((ce) => ({
        id: ce.company.id,
        name: ce.company.name,
        shortName: ce.company.shortName,
        iban: ce.company.iban,
        active: ce.active,
        startDate: ce.startDate,
        endDate: ce.endDate,
      })),
      payrollRecords: employee.payrollRecords.map((pr) => ({
        id: pr.id,
        salaryMonth: pr.salaryMonth,
        grossSalary: Number(pr.grossSalary),
        netSalary: Number(pr.netSalary),
        auszahlungsbetrag: Number(pr.auszahlungsbetrag),
        lohnsteuer: pr.lohnsteuer != null ? Number(pr.lohnsteuer) : null,
        company: pr.company,
        createdAt: pr.createdAt,
      })),
      reconciliations: employee.reconciliations.map((rec) => ({
        id: rec.id,
        companyId: rec.companyId,
        salaryMonth: rec.salaryMonth,
        expectedAmount: Number(rec.expectedAmount),
        paidAmount: Number(rec.paidAmount),
        status: rec.status,
        confidence: rec.confidence,
        matchedTransactionId: rec.matchedTransactionId,
        notes: rec.notes,
        createdAt: rec.createdAt,
      })),
      monthlyAggregation: Array.from(monthMap.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([month, data]) => ({ month, ...data })),
    })
  } catch (error) {
    console.error('[employees/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch employee' }, { status: 500 })
  }
}
