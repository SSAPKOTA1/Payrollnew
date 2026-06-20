'use strict';

const fs = require('fs');
const logger = require('./logger');

// ── Payroll header keywords (German payroll exports) ─────────────────────────
const PAYROLL_KEYWORDS = [
  'Pers.-Nr.',
  'Auszahlungsbetrag',
  'Gesamt-Brutto',
  'Lohnsteuer',
  'KV-Brutto',
  'SV-Brutto',
  'Netto',
  'Steuerklasse',
  'Personalnummer',
];

// ── Bank transaction header keywords ─────────────────────────────────────────
const BANK_KEYWORDS = [
  'Buchungstag',
  'Verwendungszweck',
  'Betrag',
  'Auftragskonto',
  'Beguenstigter',
  'Glaeubiger',
  'IBAN',
  'BIC',
  'Kontonummer',
  'Waehrung',
];

// ── Company name pattern ──────────────────────────────────────────────────────
// Matches lines like: "0001595 / 00419 Höchster Hof Hotel GmbH"
// or just a line that looks like a proper company name (GmbH, AG, KG, e.K., etc.)
const COMPANY_PATTERN =
  /(?:\d{4,7}\s*\/\s*\d{4,7}\s+)?([A-ZÄÖÜ][^,;\n]{3,80?}(?:GmbH|AG|KG|OHG|e\.K\.|UG|GbR|mbH|Co\.|Inc\.|Ltd\.)[\w\s&.,-]*)/i;

/**
 * Read the first `maxBytes` of a file and return as a UTF-8 string.
 * Non-UTF-8 bytes are replaced so parsing does not throw.
 *
 * @param {string} filePath
 * @param {number} [maxBytes=2048]
 * @returns {string}
 */
function readHead(filePath, maxBytes = 2048) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const read = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.slice(0, read).toString('utf8', 0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Count how many keywords from `list` appear in `text` (case-insensitive).
 */
function countMatches(text, list) {
  const lower = text.toLowerCase();
  return list.reduce((acc, kw) => acc + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0);
}

/**
 * Attempt to detect a company name from the first few lines.
 * German payroll files often have metadata lines before the CSV header row.
 *
 * @param {string[]} lines
 * @returns {string|null}
 */
function detectCompany(lines) {
  // Check first 3 lines only
  for (const line of lines.slice(0, 3)) {
    const match = line.match(COMPANY_PATTERN);
    if (match) {
      return match[1].trim();
    }
    // Fallback: if a line is clearly a company identifier string without the
    // numbered prefix, try to extract something that looks like a business name
    const fallback = line.match(/^([A-ZÄÖÜ][^;,\n]{5,60})$/);
    if (fallback && /GmbH|AG|KG|OHG|Hotel|Gastro|Service|Bau|Handel/i.test(fallback[1])) {
      return fallback[1].trim();
    }
  }
  return null;
}

/**
 * Classify a CSV file by inspecting its header row and first few lines.
 *
 * @param {string} filePath   Absolute path to the file
 * @param {string} [content]  Optional pre-read content (first 2 KB). If omitted,
 *                             the file is read automatically.
 * @returns {{ type: 'PAYROLL'|'BANK_TRANSACTION'|'UNKNOWN', confidence: number, detectedCompany: string|null }}
 */
function classifyFile(filePath, content) {
  let head;
  try {
    head = content !== undefined ? content : readHead(filePath, 2048);
  } catch (err) {
    logger.warn(`classifyFile: cannot read file head for ${filePath}`, { error: err.message });
    return { type: 'UNKNOWN', confidence: 0, detectedCompany: null };
  }

  const lines = head
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { type: 'UNKNOWN', confidence: 0, detectedCompany: null };
  }

  const fileName = require('path').basename(filePath).toLowerCase();

  // Filename-based detection (most reliable — DATEV files always start with lojo_)
  if (fileName.startsWith('lojo') || fileName.includes('lohn') || fileName.includes('payroll')) {
    const detectedCompany = detectCompany(lines);
    return { type: 'PAYROLL', confidence: 1, detectedCompany };
  }
  if (fileName.includes('umsatz') || fileName.includes('konto') || fileName.includes('bank')) {
    return { type: 'BANK_TRANSACTION', confidence: 1, detectedCompany: null };
  }

  // Scan all lines (DATEV payroll files have 4 metadata lines before the real header)
  const fullText = lines.join(' ');
  const payrollFull = countMatches(fullText, PAYROLL_KEYWORDS);
  const bankFull = countMatches(fullText, BANK_KEYWORDS);

  // Also weight the first line that looks like an actual header (most keywords)
  const bestHeaderLine = lines.slice(0, 10).reduce((best, line) => {
    const p = countMatches(line, PAYROLL_KEYWORDS);
    const b = countMatches(line, BANK_KEYWORDS);
    return (p + b) > (countMatches(best, PAYROLL_KEYWORDS) + countMatches(best, BANK_KEYWORDS)) ? line : best;
  }, lines[0]);
  const payrollHits = countMatches(bestHeaderLine, PAYROLL_KEYWORDS);
  const bankHits = countMatches(bestHeaderLine, BANK_KEYWORDS);

  const detectedCompany = detectCompany(lines);

  let type = 'UNKNOWN';
  let confidence = 0;

  const payrollScore = Math.max(payrollHits * 2, payrollFull);
  const bankScore = Math.max(bankHits * 2, bankFull);

  if (payrollScore === 0 && bankScore === 0) {
    return { type: 'UNKNOWN', confidence: 0, detectedCompany };
  }

  if (payrollScore >= bankScore) {
    type = 'PAYROLL';
    confidence = Math.min(1, payrollScore / (PAYROLL_KEYWORDS.length * 0.5));
  } else {
    type = 'BANK_TRANSACTION';
    confidence = Math.min(1, bankScore / (BANK_KEYWORDS.length * 0.5));
  }

  // Round to 2 decimal places
  confidence = Math.round(confidence * 100) / 100;

  logger.debug(`Classified ${filePath}`, { type, confidence, detectedCompany });

  return { type, confidence, detectedCompany };
}

module.exports = { classifyFile };
