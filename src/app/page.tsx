'use client'

import { useEffect, useState } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { StatusBadge } from '@/components/ui/StatusBadge'

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

interface CompanySummary {
  companyId: string
  companyName: string
  salaryMonth: string
  employeeCount: number
  totalEmployees: number
  totalCost: number
  paidCount: number
  unpaidCount: number
}

interface MonthlyTrend {
  month: string
  totalCost: number
  paidAmount: number
}

interface Alert {
  type: string
  message: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  createdAt: string
}

interface DashboardData {
  currentMonth: string
  availableMonths: string[]
  totalPayrollCost: number
  paidTotal: number
  unpaidTotal: number
  partialTotal: number
  needsReviewCount: number
  riskAmount: number
  companySummaries: CompanySummary[]
  monthlyTrends: MonthlyTrend[]
  recentAlerts: Alert[]
}

function TrendChart({ data }: { data: MonthlyTrend[] }) {
  if (!data || data.length === 0) return null

  const width = 600
  const height = 200
  const padLeft = 60
  const padRight = 20
  const padTop = 20
  const padBottom = 30

  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const maxVal = Math.max(...data.map((d) => Math.max(d.totalCost, d.paidAmount)), 1)

  const xScale = (i: number) => padLeft + (i / (data.length - 1)) * chartW
  const yScale = (v: number) => padTop + chartH - (v / maxVal) * chartH

  const costPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d.totalCost).toFixed(1)}`)
    .join(' ')

  const paidPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d.paidAmount).toFixed(1)}`)
    .join(' ')

  const costFill =
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d.totalCost).toFixed(1)}`).join(' ') +
    ` L${xScale(data.length - 1).toFixed(1)},${(padTop + chartH).toFixed(1)} L${padLeft.toFixed(1)},${(padTop + chartH).toFixed(1)} Z`

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: yScale(f * maxVal),
    label: fmt(f * maxVal),
  }))

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 360 }}>
        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padLeft} y1={g.y} x2={width - padRight} y2={g.y} stroke="#374151" strokeWidth="1" strokeDasharray="4 4" />
            <text x={padLeft - 6} y={g.y + 4} textAnchor="end" fill="#6B7280" fontSize="10">
              {(maxVal * [0, 0.25, 0.5, 0.75, 1][i] / 1000).toFixed(0)}k
            </text>
          </g>
        ))}

        {/* Cost area fill */}
        <path d={costFill} fill="#3B82F6" fillOpacity="0.08" />

        {/* Cost line */}
        <path d={costPath} fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinejoin="round" />

        {/* Paid line */}
        <path d={paidPath} fill="none" stroke="#10B981" strokeWidth="2" strokeLinejoin="round" strokeDasharray="6 3" />

        {/* Month labels */}
        {data.map((d, i) => {
          const showEvery = data.length > 6 ? 2 : 1
          if (i % showEvery !== 0) return null
          return (
            <text key={i} x={xScale(i)} y={height - 6} textAnchor="middle" fill="#6B7280" fontSize="10">
              {d.month.slice(2)}
            </text>
          )
        })}

        {/* Dots on cost line */}
        {data.map((d, i) => (
          <circle key={i} cx={xScale(i)} cy={yScale(d.totalCost)} r="3" fill="#3B82F6" />
        ))}
      </svg>
      <div className="flex items-center gap-5 mt-2 px-2">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-blue-500" />
          <span className="text-xs text-gray-400">Total Cost</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-green-500 border-dashed" style={{ borderTop: '2px dashed #10B981', background: 'none' }} />
          <span className="text-xs text-gray-400">Paid Amount</span>
        </div>
      </div>
    </div>
  )
}

function AlertSeverityBadge({ severity }: { severity: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const map = {
    HIGH: 'bg-red-500/15 text-red-400 border-red-500/30',
    MEDIUM: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    LOW: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${map[severity]}`}>
      {severity}
    </span>
  )
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string>('')

  const loadDashboard = (month: string) => {
    setLoading(true)
    const url = month ? `/api/dashboard?month=${month}` : '/api/dashboard'
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        // Set default selected month on first load
        if (!month && d.currentMonth) setSelectedMonth(d.currentMonth)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadDashboard('') }, [])

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month)
    loadDashboard(month)
  }

  const handleRunReconciliation = async () => {
    setRunning(true)
    setRunMsg(null)
    try {
      const res = await fetch('/api/reconciliation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setRunMsg(json.message ?? 'Reconciliation complete')
      // Reload dashboard so KPIs update immediately
      loadDashboard(selectedMonth)
    } catch (e: any) {
      setRunMsg(e.message ?? 'Failed to run reconciliation')
    } finally {
      setRunning(false)
    }
  }

  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Executive Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Month picker */}
          {data && data.availableMonths.length > 0 && (
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
            >
              {data.availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}{m === data.availableMonths[0] ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          )}
          {runMsg && (
            <span className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-1.5">
              {runMsg}
            </span>
          )}
          <button
            onClick={handleRunReconciliation}
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

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 flex items-center gap-3">
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading dashboard data...
          </div>
        </div>
      ) : !data ? (
        <div className="text-red-400">Failed to load dashboard data.</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
              title="Total Payroll Cost"
              value={fmt(data.totalPayrollCost)}
              subtitle={`Month: ${data.currentMonth}`}
              color="blue"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <KpiCard
              title="Paid Amount"
              value={fmt(data.paidTotal)}
              subtitle={
                data.totalPayrollCost > 0
                  ? `${((data.paidTotal / data.totalPayrollCost) * 100).toFixed(1)}% of total`
                  : undefined
              }
              color="green"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <KpiCard
              title="At Risk Amount"
              value={fmt(data.riskAmount)}
              subtitle={`Unpaid ${fmt(data.unpaidTotal)} + Partial ${fmt(data.partialTotal)}`}
              color="red"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              }
            />
            <KpiCard
              title="Needs Review"
              value={String(data.needsReviewCount)}
              subtitle="Records requiring manual review"
              color="yellow"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              }
            />
          </div>

          {/* Company Table + Alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Company Breakdown */}
            <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="font-semibold text-white">Company Breakdown</h2>
                <span className="text-xs text-gray-500">latest month per company</span>
              </div>
              {data.companySummaries.length === 0 ? (
                <div className="px-5 py-10 text-center text-gray-500 text-sm">No company data for this month</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                        <th className="text-left px-5 py-3">Company</th>
                        <th className="text-left px-5 py-3">Month</th>
                        <th className="text-right px-5 py-3">Employees</th>
                        <th className="text-right px-5 py-3">Total Cost</th>
                        <th className="text-right px-5 py-3">Paid</th>
                        <th className="text-right px-5 py-3">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {data.companySummaries.map((c) => (
                        <tr key={c.companyId} className="hover:bg-gray-800/50 transition-colors">
                          <td className="px-5 py-3 font-medium text-white">{c.companyName}</td>
                          <td className="px-5 py-3">
                            <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded px-2 py-0.5 font-mono">
                              {c.salaryMonth}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right text-gray-300">{c.totalEmployees}</td>
                          <td className="px-5 py-3 text-right text-gray-300">{fmt(c.totalCost)}</td>
                          <td className="px-5 py-3 text-right">
                            <span className="text-green-400">{c.paidCount}</span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {c.unpaidCount > 0 ? (
                              <span className="text-red-400 font-medium">{c.unpaidCount}</span>
                            ) : (
                              <span className="text-gray-500">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Alerts Panel */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="font-semibold text-white">Recent Alerts</h2>
                {data.recentAlerts.length > 0 && (
                  <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-full px-2 py-0.5">
                    {data.recentAlerts.length}
                  </span>
                )}
              </div>
              <div className="divide-y divide-gray-800 max-h-72 overflow-y-auto">
                {data.recentAlerts.length === 0 ? (
                  <div className="px-5 py-10 text-center text-gray-500 text-sm">No alerts</div>
                ) : (
                  data.recentAlerts.map((alert, i) => (
                    <div key={i} className="px-4 py-3 hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <AlertSeverityBadge severity={alert.severity} />
                        <span className="text-xs text-gray-600 shrink-0">
                          {new Date(alert.createdAt).toLocaleDateString('de-DE')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 leading-relaxed">{alert.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 12-Month Trend Chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white">12-Month Payroll Trend</h2>
              <p className="text-xs text-gray-500 mt-0.5">Total payroll cost vs. confirmed paid amounts</p>
            </div>
            <div className="px-5 py-4">
              <TrendChart data={data.monthlyTrends} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
