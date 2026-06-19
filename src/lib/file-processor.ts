import { prisma } from '@/lib/prisma'
import { parseCSV, parseGermanNumber, parseGermanDate, extractSalaryMonth } from '@/lib/file-parser'
import { detectFileType, detectColumnMappings } from '@/lib/schema-detector'
import { inferSalaryMonth } from '@/lib/temporal-inference'
import { normalizeIban } from '@/lib/fuzzy-matcher'

export interface ProcessResult {
  rowCount: number
  columnMappings: Record<string, string>
  detectedCompanyName?: string
  errors: string[]
}

function getColValue(row: string[], headers: string[], targetField: string, mappings: {sourceColumn: string, targetField: string, confidence: number}[]): string | null {
  const mapping = mappings.find(m => m.targetField === targetField)
  if (!mapping) return null
  const idx = headers.indexOf(mapping.sourceColumn)
  if (idx === -1) return null
  return row[idx]?.trim() || null
}

export async function processPayrollFile(
  fileId: string,
  content: Buffer,
  companyId?: string
): Promise<ProcessResult> {
  const errors: string[] = []
  const text = content.toString('latin1')
  
  // Detect company from first few lines
  let detectedCompanyName: string | undefined
  const firstLines = text.split('\n').slice(0, 5)
  for (const line of firstLines) {
    const match = line.match(/\d{4,7}\s*\/\s*\d{4,6}\s+(.+?)(;|$)/)
    if (match) {
      detectedCompanyName = match[1].trim()
      break
    }
  }

  const { headers, rows } = parseCSV(text)
  if (!headers.length) return { rowCount: 0, columnMappings: {}, errors: ['No headers found'] }

  const mappings = detectColumnMappings(headers, rows)
  const colMap: Record<string, string> = {}
  mappings.forEach(m => { colMap[m.targetField] = m.sourceColumn })

  // Detect salary month from content
  let salaryMonth: string | null = null
  for (const line of firstLines) {
    salaryMonth = extractSalaryMonth(line)
    if (salaryMonth) break
  }

  // Resolve company
  let resolvedCompanyId = companyId
  if (!resolvedCompanyId && detectedCompanyName) {
    const company = await prisma.company.findFirst({
      where: { name: { contains: detectedCompanyName, mode: 'insensitive' } }
    })
    if (company) resolvedCompanyId = company.id
    else {
      const newCompany = await prisma.company.create({ data: { name: detectedCompanyName } })
      resolvedCompanyId = newCompany.id
    }
  }
  if (!resolvedCompanyId) {
    const fallback = await prisma.company.findFirst()
    resolvedCompanyId = fallback?.id
  }
  if (!resolvedCompanyId) {
    const def = await prisma.company.create({ data: { name: 'Unknown Company' } })
    resolvedCompanyId = def.id
  }

  let rowCount = 0
  for (const row of rows) {
    if (row.every(c => !c || c.trim() === '')) continue

    const empIdRaw = getColValue(row, headers, 'employee_id', mappings)
    const empNameRaw = getColValue(row, headers, 'employee_name', mappings)
    if (!empNameRaw || empNameRaw.toLowerCase().includes('summen')) continue

    const grossRaw = getColValue(row, headers, 'gross_salary', mappings)
    const netRaw = getColValue(row, headers, 'net_salary', mappings)
    const grossSalary = parseGermanNumber(grossRaw || '') ?? 0
    const netSalary = parseGermanNumber(netRaw || '') ?? 0

    const month = salaryMonth || new Date().toISOString().slice(0, 7)

    try {
      // Upsert employee
      let employee = await prisma.employee.findFirst({
        where: empIdRaw
          ? { employeeId: empIdRaw }
          : { name: { equals: empNameRaw, mode: 'insensitive' } }
      })
      if (!employee) {
        employee = await prisma.employee.create({
          data: { employeeId: empIdRaw || undefined, name: empNameRaw }
        })
      }

      // Link employee to company
      await prisma.companyEmployee.upsert({
        where: { companyId_employeeId: { companyId: resolvedCompanyId!, employeeId: employee.id } },
        update: {},
        create: { companyId: resolvedCompanyId!, employeeId: employee.id }
      })

      // Helper to parse optional field
      const optNum = (field: string) => {
        const v = getColValue(row, headers, field, mappings)
        return v ? parseGermanNumber(v) : null
      }

      await prisma.payrollRecord.upsert({
        where: { companyId_employeeId_salaryMonth: { companyId: resolvedCompanyId!, employeeId: employee.id, salaryMonth: month } },
        update: {
          grossSalary, netSalary,
          lohnsteuer: optNum('lohnsteuer'),
          kvBeitragAN: optNum('kv_an'), rvBeitragAN: optNum('rv_an'),
          avBeitragAN: optNum('av_an'), pvBeitragAN: optNum('pv_an'),
          kvBeitragAG: optNum('kv_ag'), rvBeitragAG: optNum('rv_ag'),
          avBeitragAG: optNum('av_ag'), pvBeitragAG: optNum('pv_ag'),
          umlage1: optNum('umlage1'), umlage2: optNum('umlage2'),
          umlagInsolv: optNum('umlage_insolv'),
          auszahlungsbetrag: netSalary,
          rawData: row as any,
          uploadedFileId: fileId,
        },
        create: {
          companyId: resolvedCompanyId!, employeeId: employee.id, salaryMonth: month,
          grossSalary, netSalary,
          lohnsteuer: optNum('lohnsteuer'),
          kvBeitragAN: optNum('kv_an'), rvBeitragAN: optNum('rv_an'),
          avBeitragAN: optNum('av_an'), pvBeitragAN: optNum('pv_an'),
          kvBeitragAG: optNum('kv_ag'), rvBeitragAG: optNum('rv_ag'),
          avBeitragAG: optNum('av_ag'), pvBeitragAG: optNum('pv_ag'),
          umlage1: optNum('umlage1'), umlage2: optNum('umlage2'),
          umlagInsolv: optNum('umlage_insolv'),
          auszahlungsbetrag: netSalary,
          rawData: row as any,
          uploadedFileId: fileId,
        }
      })
      rowCount++
    } catch (err: any) {
      errors.push(`Row error: ${err.message}`)
    }
  }

  return { rowCount, columnMappings: colMap, detectedCompanyName, errors }
}

export async function processBankFile(
  fileId: string,
  content: Buffer,
  companyId?: string
): Promise<ProcessResult> {
  const errors: string[] = []
  const text = content.toString('latin1')
  const { headers, rows } = parseCSV(text)
  if (!headers.length) return { rowCount: 0, columnMappings: {}, errors: ['No headers found'] }

  const mappings = detectColumnMappings(headers, rows)
  const colMap: Record<string, string> = {}
  mappings.forEach(m => { colMap[m.targetField] = m.sourceColumn })

  let resolvedCompanyId = companyId
  let rowCount = 0

  for (const row of rows) {
    if (row.every(c => !c || c.trim() === '')) continue

    const accountIban = getColValue(row, headers, 'account_iban', mappings) || ''
    const amountRaw = getColValue(row, headers, 'amount', mappings)
    const amount = parseGermanNumber(amountRaw || '')
    if (amount === null) continue

    const bookingDateRaw = getColValue(row, headers, 'booking_date', mappings)
    const bookingDate = parseGermanDate(bookingDateRaw || '') || new Date()
    const valueDateRaw = getColValue(row, headers, 'value_date', mappings)
    const valueDate = parseGermanDate(valueDateRaw || '')

    const purpose = getColValue(row, headers, 'purpose', mappings) || ''
    const inferredMonth = inferSalaryMonth(purpose, bookingDate)

    // Auto-detect company from account IBAN
    if (!resolvedCompanyId && accountIban) {
      const company = await prisma.company.findFirst({
        where: { iban: normalizeIban(accountIban) }
      })
      if (company) resolvedCompanyId = company.id
    }
    if (!resolvedCompanyId) {
      const fallback = await prisma.company.findFirst()
      resolvedCompanyId = fallback?.id
      if (!resolvedCompanyId) {
        const def = await prisma.company.create({ data: { name: 'Unknown Company' } })
        resolvedCompanyId = def.id
      }
    }

    try {
      await prisma.bankTransaction.create({
        data: {
          companyId: resolvedCompanyId!,
          accountIban: normalizeIban(accountIban),
          bookingDate,
          valueDate: valueDate || undefined,
          bookingText: getColValue(row, headers, 'booking_text', mappings) || undefined,
          purpose: purpose || undefined,
          counterpartyName: getColValue(row, headers, 'counterparty_name', mappings) || undefined,
          counterpartyIban: getColValue(row, headers, 'counterparty_iban', mappings) ? normalizeIban(getColValue(row, headers, 'counterparty_iban', mappings)!) : undefined,
          bic: getColValue(row, headers, 'bic', mappings) || undefined,
          amount,
          currency: getColValue(row, headers, 'currency', mappings) || 'EUR',
          inferredMonth: inferredMonth || undefined,
          rawData: row as any,
          uploadedFileId: fileId,
        }
      })
      rowCount++
    } catch (err: any) {
      errors.push(`Row error: ${err.message}`)
    }
  }

  return { rowCount, columnMappings: colMap, errors }
}
