'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

interface EmployeeCompany {
  id: string
  name: string
  shortName: string | null
}

interface Employee {
  id: string
  employeeId: string | null
  name: string
  iban: string | null
  companies: EmployeeCompany[]
  latestPayroll: {
    salaryMonth: string
    netSalary: number
    grossSalary: number
    auszahlungsbetrag: number
  } | null
  reconciliationStatus: string | null
}

interface Company {
  id: string
  name: string
}

export default function EmployeesPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) params.set('search', search)
    if (companyFilter) params.set('companyId', companyFilter)

    fetch(`/api/employees?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setEmployees(data.employees ?? [])
        setTotal(data.total ?? 0)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [search, companyFilter, page])

  useEffect(() => {
    fetch('/api/companies')
      .then((r) => r.json())
      .then(setCompanies)
      .catch(console.error)
  }, [])

  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [load])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Employees</h1>
          <p className="text-sm text-gray-400 mt-0.5">{total} employees found</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, ID, or IBAN..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 placeholder-gray-500"
          />
        </div>
        <select
          value={companyFilter}
          onChange={(e) => { setCompanyFilter(e.target.value); setPage(1) }}
          className="bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="">All Companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
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
              Loading employees...
            </div>
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-16 text-gray-500">No employees found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left px-5 py-3">Name</th>
                  <th className="text-left px-5 py-3">Employee ID</th>
                  <th className="text-left px-5 py-3">Companies</th>
                  <th className="text-right px-5 py-3">Current Month Salary</th>
                  <th className="text-left px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {employees.map((emp) => {
                  const latestPayroll = emp.latestPayroll
                  return (
                    <tr
                      key={emp.id}
                      onClick={() => router.push(`/employees/${emp.id}`)}
                      className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 border border-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
                            {emp.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-white">{emp.name}</div>
                            {emp.iban && <div className="text-xs text-gray-500 font-mono">{emp.iban.slice(0, 16)}...</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-gray-400 font-mono text-xs">
                        {emp.employeeId ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {emp.companies.map((ce) => (
                            <span
                              key={ce.id}
                              className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded px-1.5 py-0.5"
                            >
                              {ce.shortName ?? ce.name}
                            </span>
                          ))}
                          {emp.companies.length === 0 && <span className="text-gray-600 text-xs">None</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {latestPayroll ? (
                          <div>
                            <div className="text-white font-medium">{fmt(Number(latestPayroll.auszahlungsbetrag))}</div>
                            <div className="text-xs text-gray-500">{latestPayroll.salaryMonth}</div>
                          </div>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge
                          status={emp.reconciliationStatus ?? (latestPayroll ? 'NEEDS_REVIEW' : 'UNPAID')}
                          size="sm"
                        />
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
