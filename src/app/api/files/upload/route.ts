import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { detectFileType, detectColumnMappings } from '@/lib/schema-detector'
import { parseCSV } from '@/lib/file-parser'
import { processPayrollFile, processBankFile } from '@/lib/file-processor'
import { runReconciliation } from '@/lib/reconciliation-engine'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const fileHashInput = formData.get('fileHash') as string | null
    const fileTypeOverride = formData.get('fileType') as string | null
    const companyId = formData.get('companyId') as string | null
    const filePath = formData.get('filePath') as string | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const content = Buffer.from(bytes)
    const crypto = await import('crypto')
    const fileHash = fileHashInput || crypto.createHash('sha256').update(content).digest('hex')

    // Check for duplicate
    const existing = await prisma.uploadedFile.findUnique({ where: { fileHash } })
    if (existing) {
      return NextResponse.json({ fileId: existing.id, duplicate: true, status: existing.status }, { status: 200 })
    }

    // Detect file type
    const { headers, rows, metadataLines } = parseCSV(content)
    const { type: detectedType } = detectFileType(headers, rows)

    // Filename-based fallback: lojo_*.csv files are always DATEV payroll exports
    const nameLower = file.name.toLowerCase()
    let fileType: 'PAYROLL' | 'BANK_TRANSACTION' | 'UNKNOWN' = (fileTypeOverride as any) || detectedType
    if (fileType === 'UNKNOWN') {
      if (nameLower.startsWith('lojo') || nameLower.includes('lohn') || nameLower.includes('payroll')) {
        fileType = 'PAYROLL'
      } else if (nameLower.includes('umsatz') || nameLower.includes('konto') || nameLower.includes('bank')) {
        fileType = 'BANK_TRANSACTION'
      }
    }
    const columnMappings = detectColumnMappings(headers, rows)

    // Create file record
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        originalName: file.name,
        filePath: filePath || undefined,
        fileHash,
        fileType,
        detectedSchema: { headers, metadataLines } as any,
        columnMappings: columnMappings as any,
        status: 'PROCESSING',
        companyId: companyId || undefined,
      }
    })

    // Process file
    let result
    if (fileType === 'PAYROLL') {
      result = await processPayrollFile(uploadedFile.id, content, companyId || undefined)
    } else if (fileType === 'BANK_TRANSACTION') {
      result = await processBankFile(uploadedFile.id, content, companyId || undefined)
    } else {
      result = { rowCount: 0, columnMappings: {}, errors: ['Unknown file type'] }
    }

    await prisma.uploadedFile.update({
      where: { id: uploadedFile.id },
      data: {
        status: result.errors.length > 0 ? 'ERROR' : 'PROCESSED',
        rowCount: result.rowCount,
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 5).join('; ') : undefined,
        processedAt: new Date(),
      }
    })

    // Auto-reconcile: find all company+month pairs that now have both payroll
    // records AND bank transactions, and run reconciliation for each.
    const reconErrors: string[] = []
    try {
      const resolvedCompanyId = result.detectedCompanyName
        ? (await prisma.company.findFirst({ where: { name: result.detectedCompanyName } }))?.id
        : companyId || undefined

      // Find all months that have payroll data for this company
      const whereCompany = resolvedCompanyId ? { companyId: resolvedCompanyId } : {}
      const payrollMonths = await prisma.payrollRecord.findMany({
        where: whereCompany,
        select: { companyId: true, salaryMonth: true },
        distinct: ['companyId', 'salaryMonth'],
      })

      for (const { companyId: cId, salaryMonth: sm } of payrollMonths) {
        // Only reconcile if there are also bank transactions for this company
        const bankCount = await prisma.bankTransaction.count({ where: { companyId: cId } })
        if (bankCount > 0) {
          await runReconciliation(cId, sm)
        }
      }
    } catch (reconErr: any) {
      reconErrors.push(`Reconciliation: ${reconErr.message}`)
    }

    return NextResponse.json({
      fileId: uploadedFile.id,
      detectedType: fileType,
      rowCount: result.rowCount,
      columnMappings: result.columnMappings,
      errors: [...result.errors, ...reconErrors].slice(0, 10),
      status: result.errors.length === 0 ? 'PROCESSED' : 'ERROR',
      reconciled: reconErrors.length === 0,
    })
  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
