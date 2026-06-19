/**
 * GET  /api/companies  – list all companies with employee count and last payroll month
 * POST /api/companies  – create a new company
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_request: NextRequest) {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { employees: true },
        },
        payrollRecords: {
          orderBy: { salaryMonth: 'desc' },
          take: 1,
          select: { salaryMonth: true },
        },
      },
    })

    const result = companies.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      iban: c.iban,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      employeeCount: c._count.employees,
      lastPayrollMonth: c.payrollRecords[0]?.salaryMonth ?? null,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('[companies] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, shortName, iban } = body as {
      name?: string
      shortName?: string
      iban?: string
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const company = await prisma.company.create({
      data: {
        name: name.trim(),
        shortName: shortName?.trim() ?? null,
        iban: iban?.trim() ?? null,
      },
    })

    return NextResponse.json(company, { status: 201 })
  } catch (error: any) {
    console.error('[companies] POST error:', error)
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'A company with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 })
  }
}
