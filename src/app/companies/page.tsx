'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'

const fmt = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

interface Company {
  id: string
  name: string
  shortName: string | null
  iban: string | null
  employeeCount: number
  lastPayrollMonth: string | null
  createdAt: string
}

interface AddModalProps {
  onClose: () => void
  onAdded: () => void
}

function AddCompanyModal({ onClose, onAdded }: AddModalProps) {
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [iban, setIban] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, shortName: shortName || null, iban: iban || null }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? 'Failed to create company')
      }
      onAdded()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Add Company</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Company Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 placeholder-gray-500"
              placeholder="Acme GmbH"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Short Name</label>
            <input
              type="text"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 placeholder-gray-500"
              placeholder="ACME"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">IBAN</label>
            <input
              type="text"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 placeholder-gray-500"
              placeholder="DE89 3704 0044 0532 0130 00"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Add Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/companies')
      .then((r) => r.json())
      .then(setCompanies)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const filtered = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.shortName ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      {showModal && <AddCompanyModal onClose={() => setShowModal(false)} onAdded={load} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Companies</h1>
          <p className="text-sm text-gray-400 mt-0.5">{companies.length} companies registered</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Company
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 placeholder-gray-500"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-gray-500 flex items-center gap-3">
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading companies...
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {search ? `No companies matching "${search}"` : 'No companies yet. Add one to get started.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => router.push(`/companies/${c.id}`)}
              className="bg-gray-900 border border-gray-800 hover:border-blue-600/50 rounded-xl p-5 flex flex-col gap-4 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">
                    {(c.shortName ?? c.name).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-white">{c.name}</div>
                    {c.shortName && <div className="text-xs text-gray-500">{c.shortName}</div>}
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-green-400 mt-1.5" title="Active" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-0.5">Employees</div>
                  <div className="text-lg font-bold text-white">{c.employeeCount}</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-0.5">Last Payroll</div>
                  <div className="text-sm font-semibold text-white">{c.lastPayrollMonth ?? '—'}</div>
                </div>
              </div>

              {c.iban && (
                <div className="text-xs text-gray-500 font-mono truncate">
                  IBAN: {c.iban}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
