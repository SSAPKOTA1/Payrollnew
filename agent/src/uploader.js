'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { computeFileHash } = require('./scanner');
const { isProcessed, markProcessed } = require('./state');
const logger = require('./logger');

/**
 * Check with the remote API whether a file with the given hash already exists.
 *
 * @param {string} hash
 * @param {string} apiUrl
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
async function existsOnServer(hash, apiUrl, apiKey) {
  try {
    const res = await axios.get(`${apiUrl}/api/files`, {
      params: { hash },
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10_000,
    });
    // Treat any 2xx with a non-empty result as "already exists"
    const data = res.data;
    if (Array.isArray(data)) return data.length > 0;
    if (data && typeof data === 'object') {
      // { exists: true } or { files: [...] } shapes
      if ('exists' in data) return Boolean(data.exists);
      if (Array.isArray(data.files)) return data.files.length > 0;
    }
    return false;
  } catch (err) {
    if (err.response && err.response.status === 404) return false;
    // Network error – treat as unknown, allow upload attempt
    logger.warn(`existsOnServer check failed for hash ${hash}`, { error: err.message });
    return false;
  }
}

/**
 * Upload a single file to the web app's ingestion endpoint.
 *
 * Steps:
 *  1. Compute SHA-256 hash
 *  2. Check local state cache – skip if already uploaded
 *  3. Check remote API – skip if server already has the file
 *  4. Build multipart form and POST
 *  5. On success, persist to local state
 *
 * @param {string} filePath         Absolute path on the local machine
 * @param {string} fileType         'PAYROLL' | 'BANK_TRANSACTION' | 'UNKNOWN'
 * @param {string|null} companyName Detected company name (may be null)
 * @param {string} apiUrl           Base URL of the web app (no trailing slash)
 * @param {string} apiKey           Bearer token for Authorization header
 * @returns {Promise<{ success: boolean, fileId?: string, rowCount?: number, skipped?: boolean, error?: string }>}
 */
async function uploadFile(filePath, fileType, companyName, apiUrl, apiKey) {
  // ── 1. Hash ────────────────────────────────────────────────────────────────
  let fileHash;
  try {
    fileHash = computeFileHash(filePath);
  } catch (err) {
    const msg = `Cannot hash file: ${err.message}`;
    logger.error(msg, { filePath });
    return { success: false, error: msg };
  }

  // ── 2. Local cache check ───────────────────────────────────────────────────
  if (isProcessed(fileHash)) {
    logger.debug(`Skipping already-processed file (local cache): ${filePath}`);
    return { success: true, skipped: true };
  }

  // ── 3. Remote check ────────────────────────────────────────────────────────
  const alreadyOnServer = await existsOnServer(fileHash, apiUrl, apiKey);
  if (alreadyOnServer) {
    logger.info(`File already exists on server – marking local and skipping: ${filePath}`);
    markProcessed(fileHash, filePath, new Date().toISOString());
    return { success: true, skipped: true };
  }

  // ── 4. Build form data and upload ─────────────────────────────────────────
  const fileName = path.basename(filePath);

  let fileStream;
  try {
    fileStream = fs.createReadStream(filePath);
  } catch (err) {
    const msg = `Cannot open file for upload: ${err.message}`;
    logger.error(msg, { filePath });
    return { success: false, error: msg };
  }

  const form = new FormData();
  form.append('file', fileStream, { filename: fileName });
  form.append('fileType', fileType);
  form.append('fileHash', fileHash);
  form.append('fileName', fileName);
  form.append('filePath', filePath);
  if (companyName) {
    form.append('detectedCompany', companyName);
  }

  logger.info(`Uploading file: ${filePath}`, { fileType, fileHash: fileHash.slice(0, 12) + '…' });

  let response;
  try {
    response = await axios.post(`${apiUrl}/api/files/upload`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${apiKey}`,
      },
      maxContentLength: 110 * 1024 * 1024, // allow up to ~110 MB response
      timeout: 120_000, // 2-minute upload timeout
    });
  } catch (err) {
    const httpStatus = err.response ? err.response.status : null;
    const serverMsg = err.response && err.response.data
      ? JSON.stringify(err.response.data)
      : err.message;
    const msg = `Upload failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${serverMsg}`;
    logger.error(msg, { filePath, fileHash });
    return { success: false, error: msg };
  }

  // ── 5. Persist locally ────────────────────────────────────────────────────
  const body = response.data || {};
  const fileId = body.fileId || body.id || null;
  const rowCount = body.rowCount ?? body.rows ?? null;

  markProcessed(fileHash, filePath, new Date().toISOString());

  logger.info(`Upload successful: ${fileName}`, { fileId, rowCount });
  return { success: true, fileId, rowCount };
}

module.exports = { uploadFile };
