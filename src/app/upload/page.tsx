'use client'

import { useEffect, useRef, useState, DragEvent, ChangeEvent, useCallback } from 'react'

interface UploadedFile {
  id: string
  originalName: string
  fileType: string | null
  status: string
  rowCount: number | null
  uploadedAt: string
  errorMessage: string | null
  company: { id: string; name: string; shortName: string | null } | null
}

const fileTypeColors: Record<string, string> = {
  PAYROLL: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  BANK_STATEMENT: 'bg-green-500/15 text-green-400 border-green-500/30',
  UNKNOWN: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-500/15 text-yellow-400',
  PROCESSING: 'bg-blue-500/15 text-blue-400',
  PROCESSED: 'bg-green-500/15 text-green-400',
  ERROR: 'bg-red-500/15 text-red-400',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function UploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    fetch('/api/files')
      .then((r) => r.json())
      .then((data) => {
        setFiles(data.files ?? [])
        setTotal(data.total ?? 0)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setUploadMsg(null)

    const results: string[] = []
    for (const file of Array.from(fileList)) {
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await fetch('/api/files/upload', { method: 'POST', body: form })
        const json = await res.json()
        if (!res.ok) {
          results.push(`${file.name}: ${json.error ?? 'Failed'}`)
        } else {
          results.push(`${file.name}: uploaded successfully`)
        }
      } catch {
        results.push(`${file.name}: upload failed`)
      }
    }

    setUploadMsg({ type: 'success', text: results.join(', ') })
    setUploading(false)
    load()
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    handleUpload(e.dataTransfer.files)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = () => setDragging(false)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleUpload(e.target.files)
    e.target.value = ''
  }

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Upload Files</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Upload payroll exports (CSV/XLSX) and bank statements for reconciliation
        </p>
      </div>

      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
          dragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-gray-700 bg-gray-900 hover:border-gray-600 hover:bg-gray-800/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.xlsx,.xls"
          onChange={handleFileChange}
          className="hidden"
        />

        {uploading ? (
          <>
            <svg className="animate-spin h-10 w-10 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div className="text-blue-400 font-medium">Uploading files...</div>
          </>
        ) : (
          <>
            <div className={`p-4 rounded-2xl ${dragging ? 'bg-blue-500/20' : 'bg-gray-800'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-10 w-10 ${dragging ? 'text-blue-400' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div className="text-center">
              <div className="text-white font-semibold text-lg">
                {dragging ? 'Drop files here' : 'Drop CSV/XLSX files here or click to browse'}
              </div>
              <div className="text-gray-500 text-sm mt-1">
                Supported: payroll exports, bank statements — .csv, .xlsx, .xls
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Select Files
            </button>
          </>
        )}
      </div>

      {uploadMsg && (
        <div className={`text-sm rounded-lg px-4 py-3 border ${
          uploadMsg.type === 'success'
            ? 'text-green-400 bg-green-500/10 border-green-500/20'
            : 'text-red-400 bg-red-500/10 border-red-500/20'
        }`}>
          {uploadMsg.text}
        </div>
      )}

      {/* File list */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-white">Uploaded Files</h2>
          <span className="text-xs text-gray-500">{total} total</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500 flex items-center gap-3">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading files...
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">No files uploaded yet</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {files.map((f) => (
              <div key={f.id} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-800/50 transition-colors">
                <div className="p-2 bg-gray-800 rounded-lg shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white text-sm truncate">{f.originalName}</span>
                    {f.fileType && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${fileTypeColors[f.fileType] ?? fileTypeColors.UNKNOWN}`}>
                        {f.fileType.replace('_', ' ')}
                      </span>
                    )}
                    {f.company && (
                      <span className="text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
                        {f.company.shortName ?? f.company.name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColors[f.status] ?? statusColors.PENDING}`}>
                      {f.status}
                    </span>
                    {f.rowCount != null && (
                      <span className="text-xs text-gray-500">{f.rowCount.toLocaleString('de-DE')} rows</span>
                    )}
                    <span className="text-xs text-gray-500">
                      {new Date(f.uploadedAt).toLocaleString('de-DE')}
                    </span>
                    {f.errorMessage && (
                      <span className="text-xs text-red-400 truncate max-w-xs">{f.errorMessage}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Local Agent section */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
          <div className="p-2 bg-blue-600/20 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Local Agent — Automatic Sync</h2>
            <p className="text-xs text-gray-500 mt-0.5">Install the desktop agent to automatically sync payroll files from your Windows machine</p>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                step: '1',
                title: 'Download Agent',
                desc: 'Download the PayrollSync Agent installer for Windows from the releases page.',
              },
              {
                step: '2',
                title: 'Configure Paths',
                desc: 'Set the folders to watch for new payroll exports and bank statements.',
              },
              {
                step: '3',
                title: 'Automatic Upload',
                desc: 'The agent monitors your folders and uploads new files automatically.',
              },
            ].map((s) => (
              <div key={s.step} className="bg-gray-800 rounded-xl p-4 flex gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-500/30 text-blue-400 text-xs font-bold flex items-center justify-center shrink-0">
                  {s.step}
                </div>
                <div>
                  <div className="font-medium text-white text-sm">{s.title}</div>
                  <div className="text-xs text-gray-400 mt-1 leading-relaxed">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700">
            <div className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wider">Quick Setup — Windows PowerShell</div>
            <pre className="text-xs text-green-400 font-mono leading-relaxed overflow-x-auto">
{`# Download and install the PayrollSync Agent
Invoke-WebRequest -Uri "https://payrollsync.local/agent/setup.exe" -OutFile setup.exe
.\\setup.exe --server-url "http://your-server:3000" --api-key "YOUR_API_KEY"

# Or configure via config file
# C:\\ProgramData\\PayrollSync\\config.json
{
  "serverUrl": "http://your-server:3000",
  "apiKey": "YOUR_API_KEY",
  "watchPaths": ["C:\\\\Payroll\\\\Exports", "C:\\\\Bank\\\\Statements"],
  "uploadIntervalSeconds": 60
}`}
            </pre>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-gray-600" />
              <span className="text-xs text-gray-500">Agent not connected</span>
            </div>
            <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              Check connection
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
