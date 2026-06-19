import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const VALID_STATUSES = new Set(['PAID', 'UNPAID', 'PARTIAL', 'NEEDS_REVIEW', 'OVERPAID'])

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId') ?? undefined
    const month = searchParams.get('month') ?? undefined
    const statusParam = searchParams.get('status')?.toUpperCase() ?? undefined
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
    const skip = (page - 1) * limit

    if (statusParam && !VALID_STATUSES.has(statusParam)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 }
      )
    }

    const where: any = {}
    if (month) where.salaryMonth = month
    if (statusParam) where.status = statusParam
    if (companyId) where.companyId = companyId

    const [records, total] = await Promise.all([
      prisma.reconciliationRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ salaryMonth: 'desc' }, { createdAt: 'desc' }],
        include: {
          employee: { select: { id: true, name: true, employeeId: true, iban: true } },
        },
      }),
      prisma.reconciliationRecord.count({ where }),
    ])

    const result = records.map((rec) => ({
      id: rec.id,
      companyId: rec.companyId,
      salaryMonth: rec.salaryMonth,
      employeeName: rec.employeeName,
      status: rec.status,
      expectedAmount: Number(rec.expectedAmount),
      paidAmount: Number(rec.paidAmount),
      confidence: rec.confidence,
      matchedTransactionId: rec.matchedTransactionId,
      notes: rec.notes,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      employee: rec.employee,
    }))

    return NextResponse.json({ records: result, total, page, limit })
  } catch (error) {
    console.error('[reconciliation] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch reconciliation records' }, { status: 500 })
  }
}
