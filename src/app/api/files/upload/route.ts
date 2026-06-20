import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { detectFileType, detectColumnMappings } from '@/lib/schema-detector'
import { parseCSV } from '@/lib/file-parser'
import { processPayrollFile, processBankFile } from '@/lib/file-processor'

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
    const fileType = (fileTypeOverride as any) || detectedType
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

    return NextResponse.json({
      fileId: uploadedFile.id,
      detectedType: fileType,
      rowCount: result.rowCount,
      columnMappings: result.columnMappings,
      errors: result.errors.slice(0, 10),
      status: result.errors.length === 0 ? 'PROCESSED' : 'ERROR',
    })
  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
