'use client'

import { useEffect, useState, useCallback } from 'react'
import { StatusBadge } from '@/components/ui/StatusBadge'

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

type RecStatus = 'PAID' | 'UNPAID' | 'PARTIAL' | 'NEEDS_REVIEW' | 'OVERPAID'

interface RecRecord {
  id: string
  salaryMonth: string
  status: RecStatus
  expectedAmount: number
  paidAmount: number | null
  confidenceScore: number | null
  employee: { id: string; name: string; employeeId: string | null; iban: string | null }
  payrollRecord: {
    id: string
    salaryMonth: string
    company: { id: string; name: string; shortName: string | null }
  } | null
}

interface Company {
  id: string
  name: string
}

const STATUS_TABS: Array<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Unpaid', value: 'UNPAID' },
  { label: 'Partial', value: 'PARTIAL' },
  { label: 'Needs Review', value: 'NEEDS_REVIEW' },
  { label: 'Overpaid', value: 'OVERPAID' },
]

export default function ReconciliationPage() {
  const [records, setRecords] = useState<RecRecord[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)

  const [companyId, setCompanyId] = useState('')
  const [month, setMonth] = useState('')
  const [statusTab, setStatusTab] = useState('')
  const [page, setPage] = useState(1)
  const limit = 50

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (companyId) params.set('companyId', companyId)
    if (month) params.set('month', month)
    if (statusTab) params.set('status', statusTab)

    fetch(`/api/reconciliation?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setRecords(data.records ?? [])
        setTotal(data.total ?? 0)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [companyId, month, statusTab, page])

  useEffect(() => {
    fetch('/api/companies')
      .then((r) => r.json())
      .then(setCompanies)
      .catch(console.error)
  }, [])

  useEffect(() => { load() }, [load])

  const handleRun = async () => {
    setRunning(true)
    setRunMsg(null)
    try {
      const body: Record<string, string> = {}
      if (companyId) body.companyId = companyId
      if (month) body.month = month

      const res = await fetch('/api/reconciliation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      setRunMsg(json.message ?? `Processed ${json.processed ?? 0} records`)
      load()
    } catch {
      setRunMsg('Reconciliation failed')
    } finally {
      setRunning(false)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reconciliation</h1>
          <p className="text-sm text-gray-400 mt-0.5">{total} records</p>
        </div>
        <div className="flex items-center gap-3">
          {runMsg && (
            <span className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-1.5">
              {runMsg}
            </span>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {running ? (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {running ? 'Running...' : 'Run Reconciliation'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={companyId}
          onChange={(e) => { setCompanyId(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="">All Companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <input
          type="month"
          value={month}
          onChange={(e) => { setMonth(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
        />

        <button
          onClick={() => { setCompanyId(''); setMonth(''); setStatusTab(''); setPage(1) }}
          className="text-sm text-gray-400 hover:text-white transition-colors px-2"
        >
          Clear filters
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusTab(tab.value); setPage(1) }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              statusTab === tab.value
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-gray-500 flex items-center gap-3">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading records...
            </div>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-16 text-gray-500">No records found for the selected filters</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left px-5 py-3">Employee</th>
                  <th className="text-left px-5 py-3">Company</th>
                  <th className="text-left px-5 py-3">Month</th>
                  <th className="text-right px-5 py-3">Expected</th>
                  <th className="text-right px-5 py-3">Paid</th>
                  <th className="text-right px-5 py-3">Difference</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Confidence</th>
                  <th className="text-left px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {records.map((rec) => {
                  const expected = Number(rec.expectedAmount)
                  const paid = rec.paidAmount != null ? Number(rec.paidAmount) : null
                  const diff = paid != null ? paid - expected : null
                  const confidence = rec.confidenceScore != null ? Number(rec.confidenceScore) : null

                  return (
                    <tr key={rec.id} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="font-medium text-white">{rec.employee.name}</div>
                        {rec.employee.employeeId && (
                          <div className="text-xs text-gray-500 font-mono">{rec.employee.employeeId}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {rec.payrollRecord?.company.shortName ?? rec.payrollRecord?.company.name ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-300">{rec.salaryMonth}</td>
                      <td className="px-5 py-3 text-right text-gray-300">{fmt(expected)}</td>
                      <td className="px-5 py-3 text-right text-gray-300">
                        {paid != null ? fmt(paid) : <span className="text-gray-600">—</span>}
                      </td>
                      <td className={`px-5 py-3 text-right font-medium ${
                        diff == null ? 'text-gray-600' : diff < -0.01 ? 'text-red-400' : diff > 0.01 ? 'text-yellow-400' : 'text-green-400'
                      }`}>
                        {diff != null ? `${diff >= 0 ? '+' : ''}${fmt(diff)}` : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={rec.status} size="sm" />
                      </td>
                      <td className="px-5 py-3">
                        {confidence != null ? (
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all ${
                                  confidence >= 0.8 ? 'bg-green-500' : confidence >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${(confidence * 100).toFixed(0)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 shrink-0">
                              {(confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                          Review
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-700 text-gray-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-700 text-gray-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
