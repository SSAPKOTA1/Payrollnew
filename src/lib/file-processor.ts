import { prisma } from '@/lib/prisma'
import { parseCSV, parseGermanNumber, parseGermanDate, extractSalaryMonth } from '@/lib/file-parser'
import { detectColumnMappings } from '@/lib/schema-detector'
import { inferSalaryMonth } from '@/lib/temporal-inference'
import { normalizeIban } from '@/lib/fuzzy-matcher'

export interface ProcessResult {
  rowCount: number
  columnMappings: Record<string, string>
  detectedCompanyName?: string
  detectedMonth?: string
  errors: string[]
}

function getColValue(
  row: string[],
  headers: string[],
  targetField: string,
  mappings: { sourceColumn: string; targetField: string; confidence: number }[]
): string | null {
  const mapping = mappings.find(m => m.targetField === targetField)
  if (!mapping) return null
  const idx = headers.indexOf(mapping.sourceColumn)
  if (idx === -1) return null
  return row[idx]?.trim() || null
}

/**
 * Extract company name and salary month from the metadata lines that appear
 * before the real header row in DATEV/payroll CSV files.
 *
 * Example metadata lines:
 *   "0001595 / 00419 Höchster Hof Hotel GmbH;"
 *   ";"
 *   "Mai 2026;"
 */
function extractPayrollMetadata(metadataLines: string[]): {
  companyName: string | undefined
  salaryMonth: string | null
} {
  let companyName: string | undefined
  let salaryMonth: string | null = null

  for (const line of metadataLines) {
    const clean = line.replace(/;/g, ' ').trim()
    if (!clean) continue

    // Company name: e.g. "0001595 / 00419 Höchster Hof Hotel GmbH"
    if (!companyName) {
      const match = clean.match(/\d{3,7}\s*\/\s*\d{3,6}\s+(.+)/)
      if (match) {
        companyName = match[1].trim()
        continue
      }
    }

    // Salary month: e.g. "Mai 2026", "05/2026", "2026-05"
    if (!salaryMonth) {
      salaryMonth = extractSalaryMonth(clean)
    }
  }

  return { companyName, salaryMonth }
}

async function resolveCompany(
  companyId: string | undefined,
  detectedName: string | undefined
): Promise<string> {
  if (companyId) return companyId

  if (detectedName) {
    // Try exact match first, then partial
    let company = await prisma.company.findFirst({
      where: { name: detectedName },
    })
    if (!company) {
      company = await prisma.company.findFirst({
        where: { name: { contains: detectedName.slice(0, 20) } },
      })
    }
    if (company) return company.id

    // Create new company from detected name
    const created = await prisma.company.create({ data: { name: detectedName } })
    return created.id
  }

  // Last resort: use first existing company or create a placeholder
  const fallback = await prisma.company.findFirst()
  if (fallback) return fallback.id

  const placeholder = await prisma.company.create({ data: { name: 'Unknown Company' } })
  return placeholder.id
}

export async function processPayrollFile(
  fileId: string,
  content: Buffer,
  companyId?: string
): Promise<ProcessResult> {
  const errors: string[] = []

  const { headers, rows, metadataLines } = parseCSV(content)

  if (!headers.length) {
    return { rowCount: 0, columnMappings: {}, errors: ['No header row found in file'] }
  }

  // Extract company + month from the metadata lines above the header
  const { companyName: detectedCompanyName, salaryMonth: detectedMonth } =
    extractPayrollMetadata(metadataLines)

  // Fall back to scanning all lines if metadata didn't yield a month
  let salaryMonth = detectedMonth
  if (!salaryMonth) {
    for (const line of metadataLines) {
      salaryMonth = extractSalaryMonth(line)
      if (salaryMonth) break
    }
  }
  if (!salaryMonth) {
    // Last resort: current month
    salaryMonth = new Date().toISOString().slice(0, 7)
    errors.push(`Could not detect salary month — defaulting to ${salaryMonth}`)
  }

  const mappings = detectColumnMappings(headers, rows)
  const colMap: Record<string, string> = {}
  mappings.forEach(m => { colMap[m.targetField] = m.sourceColumn })

  const resolvedCompanyId = await resolveCompany(companyId, detectedCompanyName)

  let rowCount = 0

  for (const row of rows) {
    if (row.every(c => !c || c.trim() === '')) continue

    const empIdRaw = getColValue(row, headers, 'employee_id', mappings)
    const empNameRaw = getColValue(row, headers, 'employee_name', mappings)

    // Skip summary rows and empty name rows
    if (!empNameRaw) continue
    const nameLower = empNameRaw.toLowerCase()
    if (
      nameLower.includes('summen') ||
      nameLower.includes('gesamt') ||
      nameLower.includes('total')
    ) continue

    const grossRaw = getColValue(row, headers, 'gross_salary', mappings)
    const netRaw = getColValue(row, headers, 'net_salary', mappings)
    const grossSalary = parseGermanNumber(grossRaw || '') ?? 0
    const netSalary = parseGermanNumber(netRaw || '') ?? 0

    // Skip rows with no meaningful salary data (e.g. empty/zero rows like Yousaf, Nawaz)
    if (grossSalary === 0 && netSalary === 0) {
      const anyNum = mappings.some(m => {
        const v = getColValue(row, headers, m.targetField, mappings)
        return v && parseGermanNumber(v) !== null && parseGermanNumber(v) !== 0
      })
      if (!anyNum) continue
    }

    try {
      // Upsert employee — match by employeeId first, then by exact name
      let employee = empIdRaw
        ? await prisma.employee.findFirst({ where: { employeeId: empIdRaw } })
        : await prisma.employee.findFirst({ where: { name: empNameRaw } })

      if (!employee) {
        employee = await prisma.employee.create({
          data: { employeeId: empIdRaw || undefined, name: empNameRaw },
        })
      } else if (empIdRaw && !employee.employeeId) {
        // Backfill employeeId if we now know it
        employee = await prisma.employee.update({
          where: { id: employee.id },
          data: { employeeId: empIdRaw },
        })
      }

      // Link employee ↔ company
      await prisma.companyEmployee.upsert({
        where: {
          companyId_employeeId: { companyId: resolvedCompanyId, employeeId: employee.id },
        },
        update: {},
        create: { companyId: resolvedCompanyId, employeeId: employee.id },
      })

      const optNum = (field: string): number | null => {
        const v = getColValue(row, headers, field, mappings)
        return v ? parseGermanNumber(v) : null
      }

      // Use Auszahlungsbetrag as the definitive net pay; fall back to netSalary
      const auszahlungsbetrag = optNum('net_salary') ?? netSalary

      const payrollData = {
        grossSalary,
        netSalary: grossSalary, // Gesamt-Brutto
        lohnsteuer: optNum('lohnsteuer'),
        kvBeitragAN: optNum('kv_an'),
        rvBeitragAN: optNum('rv_an'),
        avBeitragAN: optNum('av_an'),
        pvBeitragAN: optNum('pv_an'),
        kvBeitragAG: optNum('kv_ag'),
        rvBeitragAG: optNum('rv_ag'),
        avBeitragAG: optNum('av_ag'),
        pvBeitragAG: optNum('pv_ag'),
        umlage1: optNum('umlage1'),
        umlage2: optNum('umlage2'),
        umlagInsolv: optNum('umlage_insolv'),
        auszahlungsbetrag,
        rawData: row as any,
        uploadedFileId: fileId,
      }

      await prisma.payrollRecord.upsert({
        where: {
          companyId_employeeId_salaryMonth: {
            companyId: resolvedCompanyId,
            employeeId: employee.id,
            salaryMonth,
          },
        },
        update: payrollData,
        create: {
          companyId: resolvedCompanyId,
          employeeId: employee.id,
          salaryMonth,
          ...payrollData,
        },
      })

      rowCount++
    } catch (err: any) {
      errors.push(`Row "${empNameRaw}": ${err.message}`)
    }
  }

  return { rowCount, columnMappings: colMap, detectedCompanyName, detectedMonth: salaryMonth, errors }
}

export async function processBankFile(
  fileId: string,
  content: Buffer,
  companyId?: string
): Promise<ProcessResult> {
  const errors: string[] = []

  const { headers, rows } = parseCSV(content)
  if (!headers.length) {
    return { rowCount: 0, columnMappings: {}, errors: ['No header row found in file'] }
  }

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
        where: { iban: normalizeIban(accountIban) },
      })
      if (company) resolvedCompanyId = company.id
    }
    if (!resolvedCompanyId) {
      resolvedCompanyId = await resolveCompany(undefined, undefined)
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
          counterpartyIban: (() => {
            const raw = getColValue(row, headers, 'counterparty_iban', mappings)
            return raw ? normalizeIban(raw) : undefined
          })(),
          bic: getColValue(row, headers, 'bic', mappings) || undefined,
          amount,
          currency: getColValue(row, headers, 'currency', mappings) || 'EUR',
          inferredMonth: inferredMonth || undefined,
          rawData: row as any,
          uploadedFileId: fileId,
        },
      })
      rowCount++
    } catch (err: any) {
      errors.push(`Bank row error: ${err.message}`)
    }
  }

  return { rowCount, columnMappings: colMap, errors }
}
