'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

function formatMonth(ym: string): string {
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  const [year, month] = ym.split('-').map(Number)
  return `${months[month - 1]} ${year}`
}

interface PayrollSummary {
  salaryMonth: string
  employeeCount: number
  totalGross: number
  totalNet: number
  totalPayout: number
}

interface EmployeeMonthRow {
  id: string
  name: string
  employeeId: string | null
  grossSalary: number
  auszahlungsbetrag: number
  paidAmount: number | null
  reconciliationStatus: string | null
}

interface CompanyDetail {
  id: string
  name: string
  shortName: string | null
  iban: string | null
  latestMonth: string | null
  activeMonth: string | null
  payrollSummary: PayrollSummary[]
  reconciliationSummary: Record<string, number>
  employeeMonthData: EmployeeMonthRow[]
}

// Simple SVG bar chart
function BarChart({
  data,
  selectedMonth,
  onSelectMonth,
}: {
  data: PayrollSummary[]
  selectedMonth: string | null
  onSelectMonth: (m: string) => void
}) {
  if (data.length === 0) return null

  // Show last 12 months max, chronological order
  const sorted = [...data].sort((a, b) => a.salaryMonth.localeCompare(b.salaryMonth)).slice(-12)
  const maxVal = Math.max(...sorted.map((d) => d.totalPayout), 1)

  const chartH = 180
  const barW = 36
  const gap = 12
  const paddingLeft = 60
  const paddingBottom = 40
  const totalW = paddingLeft + sorted.length * (barW + gap)

  // Y-axis gridlines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    y: chartH - r * chartH,
    val: maxVal * r,
  }))

  return (
    <div className="overflow-x-auto">
      <svg
        width={totalW}
        height={chartH + paddingBottom + 16}
        className="select-none"
        style={{ minWidth: '100%' }}
      >
        {/* Grid lines */}
        {gridLines.map((gl, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={gl.y + 8}
              x2={totalW}
              y2={gl.y + 8}
              stroke="#374151"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={paddingLeft - 6}
              y={gl.y + 12}
              textAnchor="end"
              fontSize={9}
              fill="#6b7280"
            >
              {gl.val >= 1000 ? `${(gl.val / 1000).toFixed(0)}k` : gl.val.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Bars */}
        {sorted.map((d, i) => {
          const barH = Math.max(2, (d.totalPayout / maxVal) * chartH)
          const x = paddingLeft + i * (barW + gap)
          const y = chartH - barH + 8
          const isSelected = d.salaryMonth === selectedMonth
          return (
            <g key={d.salaryMonth} onClick={() => onSelectMonth(d.salaryMonth)} style={{ cursor: 'pointer' }}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={4}
                fill={isSelected ? '#3b82f6' : '#1d4ed8'}
                opacity={isSelected ? 1 : 0.65}
                className="transition-all"
              />
              {isSelected && (
                <rect x={x} y={y} width={barW} height={barH} rx={4} fill="url(#selGlow)" opacity={0.3} />
              )}
              {/* Amount label on top of bar */}
              {barH > 20 && (
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={8}
                  fill={isSelected ? '#93c5fd' : '#6b7280'}
                >
                  {d.totalPayout >= 1000 ? `${(d.totalPayout / 1000).toFixed(1)}k` : d.totalPayout.toFixed(0)}
                </text>
              )}
              {/* Month label */}
              <text
                x={x + barW / 2}
                y={chartH + paddingBottom - 4}
                textAnchor="middle"
                fontSize={9}
                fill={isSelected ? '#93c5fd' : '#9ca3af'}
              >
                {formatMonth(d.salaryMonth)}
              </text>
            </g>
          )
        })}
        <defs>
          <radialGradient id="selGlow">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </radialGradient>
        </defs>
      </svg>
    </div>
  )
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<CompanyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [monthLoading, setMonthLoading] = useState(false)

  // Load company base data (no month filter)
  useEffect(() => {
    setLoading(true)
    fetch(`/api/companies/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setSelectedMonth(d.latestMonth ?? null)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  // Load employee data for selected month
  const loadMonth = useCallback(
    (month: string) => {
      setMonthLoading(true)
      fetch(`/api/companies/${id}?month=${month}`)
        .then((r) => r.json())
        .then((d) => {
          setData((prev) => prev ? { ...prev, employeeMonthData: d.employeeMonthData, reconciliationSummary: d.reconciliationSummary, activeMonth: d.activeMonth } : d)
        })
        .catch(console.error)
        .finally(() => setMonthLoading(false))
    },
    [id]
  )

  const handleBarClick = (month: string) => {
    setSelectedMonth(month)
    loadMonth(month)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 flex items-center gap-3">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading company...
        </div>
      </div>
    )
  }

  if (!data || (data as { error?: string }).error) {
    return (
      <div className="p-6 text-center text-gray-500">
        Company not found.{' '}
        <button onClick={() => router.push('/companies')} className="text-blue-400 hover:underline">
          Back to companies
        </button>
      </div>
    )
  }

  const selectedSummary = data.payrollSummary.find((p) => p.salaryMonth === selectedMonth)
  const paid = data.reconciliationSummary['PAID'] ?? 0
  const unpaid = data.reconciliationSummary['UNPAID'] ?? 0
  const partial = data.reconciliationSummary['PARTIAL'] ?? 0
  const needsReview = data.reconciliationSummary['NEEDS_REVIEW'] ?? 0
  const overpaid = data.reconciliationSummary['OVERPAID'] ?? 0

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/companies')}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">
            {(data.shortName ?? data.name).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{data.name}</h1>
            {data.shortName && <p className="text-sm text-gray-500">{data.shortName}</p>}
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-white">Salary Payouts by Month</h2>
            <p className="text-xs text-gray-500 mt-0.5">Click a bar to view employees for that month</p>
          </div>
          {selectedMonth && (
            <span className="text-sm text-blue-400 font-medium bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-lg">
              {formatMonth(selectedMonth)}
            </span>
          )}
        </div>
        <BarChart
          data={data.payrollSummary}
          selectedMonth={selectedMonth}
          onSelectMonth={handleBarClick}
        />
      </div>

      {/* KPI row for selected month */}
      {selectedSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Total Payout</div>
            <div className="text-xl font-bold text-white">{fmt(selectedSummary.totalPayout)}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Employees</div>
            <div className="text-xl font-bold text-white">{selectedSummary.employeeCount}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Paid</div>
            <div className="text-xl font-bold text-green-400">{paid + overpaid}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Pending / Review</div>
            <div className="text-xl font-bold text-red-400">{unpaid + partial + needsReview}</div>
          </div>
        </div>
      )}

      {/* Employee list for selected month */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            Employees{selectedMonth ? ` — ${formatMonth(selectedMonth)}` : ''}
          </h2>
          {monthLoading && (
            <svg className="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>

        {data.employeeMonthData.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">
            {selectedMonth ? `No payroll data for ${formatMonth(selectedMonth)}` : 'Select a month from the chart above'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left px-5 py-3">Employee</th>
                  <th className="text-left px-5 py-3">ID</th>
                  <th className="text-right px-5 py-3">Gross</th>
                  <th className="text-right px-5 py-3">Net (Payout)</th>
                  <th className="text-right px-5 py-3">Bank Transfer</th>
                  <th className="text-left px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.employeeMonthData
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((emp) => (
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
                          <span className="font-medium text-white">{emp.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-gray-400 font-mono text-xs">
                        {emp.employeeId ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-300">
                        {fmt(emp.grossSalary)}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-white">
                        {fmt(emp.auszahlungsbetrag)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {emp.paidAmount != null && emp.paidAmount > 0 ? (
                          <span className={
                            emp.paidAmount >= emp.auszahlungsbetrag * 0.99
                              ? 'text-green-400 font-medium'
                              : 'text-yellow-400 font-medium'
                          }>
                            {fmt(emp.paidAmount)}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge
                          status={emp.reconciliationStatus ?? 'UNPAID'}
                          size="sm"
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
