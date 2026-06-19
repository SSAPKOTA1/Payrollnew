/**
 * GET /api/employees/[id]
 *
 * Full employee detail including:
 *   - All companies the employee belongs to
 *   - All payroll records across all months
 *   - All reconciliation records
 */

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
          include: {
            company: {
              select: { id: true, name: true, shortName: true, iban: true },
            },
          },
          orderBy: { startDate: 'desc' },
        },
        payrollRecords: {
          orderBy: { salaryMonth: 'desc' },
          include: {
            company: { select: { id: true, name: true, shortName: true } },
          },
        },
        reconciliations: {
          orderBy: { salaryMonth: 'desc' },
          include: {
            payrollRecord: {
              select: {
                id: true,
                salaryMonth: true,
                grossSalary: true,
                netSalary: true,
                auszahlungsbetrag: true,
                companyId: true,
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
              },
            },
          },
        },
      },
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      iban: employee.iban,
      taxClass: employee.taxClass,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
      companies: employee.companies.map((ce) => ({
        id: ce.company.id,
        name: ce.company.name,
        shortName: ce.company.shortName,
        iban: ce.company.iban,
        startDate: ce.startDate,
        endDate: ce.endDate,
        active: ce.active,
      })),
      payrollRecords: employee.payrollRecords.map((pr) => ({
        id: pr.id,
        salaryMonth: pr.salaryMonth,
        company: pr.company,
        grossSalary: Number(pr.grossSalary),
        netSalary: Number(pr.netSalary),
        auszahlungsbetrag: Number(pr.auszahlungsbetrag),
        lohnsteuer: pr.lohnsteuer != null ? Number(pr.lohnsteuer) : null,
        kvBeitragAN: pr.kvBeitragAN != null ? Number(pr.kvBeitragAN) : null,
        rvBeitragAN: pr.rvBeitragAN != null ? Number(pr.rvBeitragAN) : null,
        avBeitragAN: pr.avBeitragAN != null ? Number(pr.avBeitragAN) : null,
        pvBeitragAN: pr.pvBeitragAN != null ? Number(pr.pvBeitragAN) : null,
        createdAt: pr.createdAt,
      })),
      reconciliations: employee.reconciliations.map((rec) => ({
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
        payrollRecord: rec.payrollRecord
          ? {
              id: rec.payrollRecord.id,
              salaryMonth: rec.payrollRecord.salaryMonth,
              grossSalary: Number(rec.payrollRecord.grossSalary),
              netSalary: Number(rec.payrollRecord.netSalary),
              auszahlungsbetrag: Number(rec.payrollRecord.auszahlungsbetrag),
              companyId: rec.payrollRecord.companyId,
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
            }
          : null,
      })),
    })
  } catch (error) {
    console.error('[employees/id] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch employee' }, { status: 500 })
  }
}
