'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Recursively scan a directory and return metadata for every file found.
 *
 * @param {string} rootPath  Directory to scan (e.g. "D:\")
 * @returns {Array<{filePath:string, relativePath:string, fileName:string, extension:string, size:number, modifiedAt:Date}>}
 */
function scanDirectory(rootPath) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Common on Windows: access denied to system folders – skip silently
      logger.debug(`Skipping inaccessible directory: ${dir}`, { error: err.message });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        // Skip symlinks to avoid loops
        continue;
      }

      if (entry.isDirectory()) {
        // Skip well-known system / noise directories on Windows
        const skip = [
          '$Recycle.Bin',
          'System Volume Information',
          'Windows',
          'Program Files',
          'Program Files (x86)',
          'ProgramData',
          'AppData',
          'node_modules',
          '.git',
        ];
        if (skip.some((s) => entry.name.toLowerCase() === s.toLowerCase())) {
          logger.debug(`Skipping system directory: ${fullPath}`);
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          const ext = path.extname(entry.name);
          results.push({
            filePath: fullPath,
            relativePath: path.relative(rootPath, fullPath),
            fileName: entry.name,
            extension: ext,
            size: stat.size,
            modifiedAt: stat.mtime,
          });
        } catch (err) {
          logger.debug(`Cannot stat file: ${fullPath}`, { error: err.message });
        }
      }
    }
  }

  logger.info(`Starting directory scan: ${rootPath}`);
  walk(rootPath);
  logger.info(`Scan complete. Found ${results.length} file(s) in ${rootPath}`);
  return results;
}

/**
 * Compute SHA-256 hash of a file's content.
 *
 * @param {string} filePath
 * @returns {string} hex-encoded SHA-256
 */
function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const CHUNK = 64 * 1024; // 64 KB read buffer
    const buf = Buffer.alloc(CHUNK);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      hash.update(buf.slice(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Decide whether a file should be processed.
 * Rules:
 *   - Extension must be in the supported list (case-insensitive)
 *   - File must be non-empty
 *   - File must be smaller than 100 MB
 *
 * @param {string} filePath
 * @param {string} extension   e.g. ".csv"
 * @param {string[]} allowedExtensions  e.g. [".csv", ".CSV"]
 * @returns {boolean}
 */
function shouldProcessFile(filePath, extension, allowedExtensions) {
  // Extension check (case-insensitive)
  const extLower = extension.toLowerCase();
  const allowed = (allowedExtensions || ['.csv']).map((e) => e.toLowerCase());
  if (!allowed.includes(extLower)) {
    return false;
  }

  // Size check
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }

  if (stat.size === 0) {
    logger.debug(`Skipping empty file: ${filePath}`);
    return false;
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    logger.warn(`Skipping oversized file (>${MAX_FILE_SIZE_BYTES / 1e6} MB): ${filePath}`, {
      size: stat.size,
    });
    return false;
  }

  return true;
}

module.exports = { scanDirectory, computeFileHash, shouldProcessFile };
