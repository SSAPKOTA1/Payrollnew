/**
 * GET /api/reconciliation
 *
 * List reconciliation records with filters.
 * Query params: ?companyId=, ?month=, ?status=, ?page=1&limit=50
 *
 * Returns records joined with employee and payroll info.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, ReconciliationStatus } from '@prisma/client'

const VALID_STATUSES = new Set<ReconciliationStatus>(['PAID', 'UNPAID', 'PARTIAL', 'NEEDS_REVIEW', 'OVERPAID'])

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId') ?? undefined
    const month = searchParams.get('month') ?? undefined
    const statusParam = searchParams.get('status')?.toUpperCase() as ReconciliationStatus | undefined
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
    const skip = (page - 1) * limit

    if (statusParam && !VALID_STATUSES.has(statusParam)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` },
        { status: 400 }
      )
    }

    // Build where clause
    const where: Prisma.ReconciliationRecordWhereInput = {}

    if (month) {
      where.salaryMonth = month
    }

    if (statusParam) {
      where.status = statusParam
    }

    if (companyId) {
      where.payrollRecord = { companyId }
    }

    const [records, total] = await Promise.all([
      prisma.reconciliationRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ salaryMonth: 'desc' }, { createdAt: 'desc' }],
        include: {
          employee: {
            select: { id: true, name: true, employeeId: true, iban: true },
          },
          payrollRecord: {
            select: {
              id: true,
              salaryMonth: true,
              grossSalary: true,
              netSalary: true,
              auszahlungsbetrag: true,
              companyId: true,
              company: { select: { id: true, name: true, shortName: true } },
            },
          },
          bankTransaction: {
            select: {
              id: true,
              bookingDate: true,
              amount: true,
              counterpartyName: true,
              counterpartyIban: true,
              purpose: true,
              accountIban: true,
            },
          },
        },
      }),
      prisma.reconciliationRecord.count({ where }),
    ])

    const result = records.map((rec) => ({
      id: rec.id,
      salaryMonth: rec.salaryMonth,
      status: rec.status,
      expectedAmount: Number(rec.expectedAmount),
      paidAmount: rec.paidAmount != null ? Number(rec.paidAmount) : null,
      matchConfidence: rec.matchConfidence,
      matchReasons: rec.matchReasons,
      notes: rec.notes,
      reviewedAt: rec.reviewedAt,
      reviewedBy: rec.reviewedBy,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      employee: rec.employee,
      payrollRecord: rec.payrollRecord
        ? {
            id: rec.payrollRecord.id,
            salaryMonth: rec.payrollRecord.salaryMonth,
            grossSalary: Number(rec.payrollRecord.grossSalary),
            netSalary: Number(rec.payrollRecord.netSalary),
            auszahlungsbetrag: Number(rec.payrollRecord.auszahlungsbetrag),
            companyId: rec.payrollRecord.companyId,
            company: rec.payrollRecord.company,
          }
        : null,
      bankTransaction: rec.bankTransaction
        ? {
            id: rec.bankTransaction.id,
            bookingDate: rec.bankTransaction.bookingDate,
            amount: Number(rec.bankTransaction.amount),
            counterpartyName: rec.bankTransaction.counterpartyName,
            counterpartyIban: rec.bankTransaction.counterpartyIban,
            purpose: rec.bankTransaction.purpose,
            accountIban: rec.bankTransaction.accountIban,
          }
        : null,
    }))

    return NextResponse.json({ records: result, total, page, limit })
  } catch (error) {
    console.error('[reconciliation] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch reconciliation records' }, { status: 500 })
  }
}
