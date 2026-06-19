'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

interface PayrollRecord {
  id: string
  salaryMonth: string
  grossSalary: number
  netSalary: number
  auszahlungsbetrag: number
  company: { id: string; name: string; shortName: string | null }
}

interface ReconciliationRecord {
  id: string
  salaryMonth: string
  status: string
  expectedAmount: number
  paidAmount: number | null
  confidenceScore: number | null
  payrollRecord: {
    id: string
    salaryMonth: string
    grossSalary: number
    netSalary: number
    auszahlungsbetrag: number
    companyId: string
  } | null
  bankTransaction: {
    id: string
    bookingDate: string
    amount: number
    counterpartyName: string | null
    counterpartyIban: string | null
    purpose: string | null
  } | null
}

interface EmployeeDetail {
  id: string
  employeeId: string | null
  name: string
  iban: string | null
  taxClass: string | null
  companies: Array<{
    company: { id: string; name: string; shortName: string | null; iban: string | null }
    startDate: string | null
    endDate: string | null
    active: boolean
  }>
  payrollRecords: PayrollRecord[]
  reconciliations: ReconciliationRecord[]
}

interface MonthAggregate {
  month: string
  totalExpected: number
  totalPaid: number
  records: ReconciliationRecord[]
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/employees/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Employee not found')
        return r.json()
      })
      .then(setEmployee)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 flex items-center gap-3">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading employee...
        </div>
      </div>
    )
  }

  if (error || !employee) {
    return (
      <div className="p-6">
        <div className="text-red-400">{error ?? 'Employee not found'}</div>
        <button onClick={() => router.back()} className="mt-3 text-sm text-blue-400 hover:underline">
          Go back
        </button>
      </div>
    )
  }

  // Build month aggregates from reconciliation records
  const monthMap = new Map<string, MonthAggregate>()
  for (const rec of employee.reconciliations) {
    const existing = monthMap.get(rec.salaryMonth) ?? {
      month: rec.salaryMonth,
      totalExpected: 0,
      totalPaid: 0,
      records: [],
    }
    existing.totalExpected += Number(rec.expectedAmount)
    existing.totalPaid += Number(rec.paidAmount ?? 0)
    existing.records.push(rec)
    monthMap.set(rec.salaryMonth, existing)
  }
  const monthAggregates = Array.from(monthMap.values()).sort((a, b) =>
    b.month.localeCompare(a.month)
  )

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Employees
      </button>

      {/* Header */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 border border-gray-700 flex items-center justify-center text-2xl font-bold text-gray-300 shrink-0">
            {employee.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{employee.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {employee.employeeId && (
                <span className="text-sm text-gray-400 font-mono">ID: {employee.employeeId}</span>
              )}
              {employee.taxClass && (
                <span className="text-sm text-gray-400">Tax Class: {employee.taxClass}</span>
              )}
              {employee.iban && (
                <span className="text-xs text-gray-500 font-mono bg-gray-800 px-2 py-1 rounded">
                  {employee.iban}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {employee.companies.map((ce) => (
                <span
                  key={ce.company.id}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                    ce.active
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                      : 'bg-gray-800 text-gray-500 border-gray-700'
                  }`}
                >
                  {ce.company.name}
                  {!ce.active && ' (inactive)'}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Cross-company aggregation */}
      {monthAggregates.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="font-semibold text-white">Cross-Company Monthly Aggregation</h2>
            <p className="text-xs text-gray-500 mt-0.5">Total income across all companies per month</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left px-5 py-3">Month</th>
                  <th className="text-right px-5 py-3">Total Expected</th>
                  <th className="text-right px-5 py-3">Total Paid</th>
                  <th className="text-right px-5 py-3">Difference</th>
                  <th className="text-left px-5 py-3">Companies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {monthAggregates.map((agg) => {
                  const diff = agg.totalPaid - agg.totalExpected
                  return (
                    <tr key={agg.month} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-white">{agg.month}</td>
                      <td className="px-5 py-3 text-right text-gray-300">{fmt(agg.totalExpected)}</td>
                      <td className="px-5 py-3 text-right text-gray-300">{fmt(agg.totalPaid)}</td>
                      <td className={`px-5 py-3 text-right font-medium ${diff < 0 ? 'text-red-400' : diff > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {diff >= 0 ? '+' : ''}{fmt(diff)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {agg.records.map((r) => {
                            const company = employee.companies.find(
                              (ce) => ce.company.id === r.payrollRecord?.companyId
                            )
                            return company ? (
                              <span key={r.id} className="text-xs bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">
                                {company.company.shortName ?? company.company.name}
                              </span>
                            ) : null
                          })}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Income Timeline */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">Income Timeline</h2>
          <p className="text-xs text-gray-500 mt-0.5">Payroll expected vs. bank payments</p>
        </div>
        {employee.reconciliations.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-500 text-sm">No reconciliation data yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left px-5 py-3">Month</th>
                  <th className="text-left px-5 py-3">Company</th>
                  <th className="text-right px-5 py-3">Expected</th>
                  <th className="text-right px-5 py-3">Bank Paid</th>
                  <th className="text-right px-5 py-3">Difference</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {employee.reconciliations.map((rec) => {
                  const expected = Number(rec.expectedAmount)
                  const paid = Number(rec.paidAmount ?? 0)
                  const diff = paid - expected
                  const confidence = rec.confidenceScore != null ? Number(rec.confidenceScore) : null
                  const company = employee.companies.find(
                    (ce) => ce.company.id === rec.payrollRecord?.companyId
                  )

                  return (
                    <tr key={rec.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-white">{rec.salaryMonth}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {company?.company.shortName ?? company?.company.name ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-300">{fmt(expected)}</td>
                      <td className="px-5 py-3 text-right text-gray-300">
                        {rec.paidAmount != null ? fmt(paid) : '—'}
                      </td>
                      <td className={`px-5 py-3 text-right font-medium ${diff < -1 ? 'text-red-400' : diff > 1 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {rec.paidAmount != null ? `${diff >= 0 ? '+' : ''}${fmt(diff)}` : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={rec.status} size="sm" />
                      </td>
                      <td className="px-5 py-3">
                        {confidence != null ? (
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${
                                  confidence >= 0.8
                                    ? 'bg-green-500'
                                    : confidence >= 0.5
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${(confidence * 100).toFixed(0)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 shrink-0">
                              {(confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
