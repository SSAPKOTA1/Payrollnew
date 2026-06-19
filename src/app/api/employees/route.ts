/**
 * GET /api/employees
 *
 * List employees with optional filters.
 * Query params: ?companyId=, ?search=, ?page=1&limit=20
 *
 * Returns employees with their companies and latest payroll record.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId') ?? undefined
    const search = searchParams.get('search')?.trim() ?? undefined
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const skip = (page - 1) * limit

    const where: any = {}

    if (companyId) {
      where.companies = { some: { companyId, active: true } }
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { employeeId: { contains: search } },
        { iban: { contains: search } },
      ]
    }

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          companies: {
            include: {
              company: { select: { id: true, name: true, shortName: true } },
            },
            where: { active: true },
          },
          payrollRecords: {
            orderBy: { salaryMonth: 'desc' },
            take: 1,
            select: {
              salaryMonth: true,
              netSalary: true,
              grossSalary: true,
              auszahlungsbetrag: true,
            },
          },
        },
      }),
      prisma.employee.count({ where }),
    ])

    const result = employees.map((emp) => ({
      id: emp.id,
      employeeId: emp.employeeId,
      name: emp.name,
      iban: emp.iban,
      taxClass: emp.taxClass,
      createdAt: emp.createdAt,
      updatedAt: emp.updatedAt,
      companies: emp.companies.map((ce) => ({
        id: ce.company.id,
        name: ce.company.name,
        shortName: ce.company.shortName,
        startDate: ce.startDate,
        endDate: ce.endDate,
        active: ce.active,
      })),
      latestPayroll: emp.payrollRecords[0]
        ? {
            salaryMonth: emp.payrollRecords[0].salaryMonth,
            netSalary: Number(emp.payrollRecords[0].netSalary),
            grossSalary: Number(emp.payrollRecords[0].grossSalary),
            auszahlungsbetrag: Number(emp.payrollRecords[0].auszahlungsbetrag),
          }
        : null,
    }))

    return NextResponse.json({ employees: result, total, page, limit })
  } catch (error) {
    console.error('[employees] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 })
  }
}
