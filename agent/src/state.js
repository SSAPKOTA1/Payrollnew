'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATE_FILE = path.join(__dirname, '..', '.payrollsync-state.json');

const DEFAULT_STATE = {
  version: 1,
  processedHashes: {},
  stats: {
    totalProcessed: 0,
    lastScanAt: null,
    lastUploadAt: null,
  },
};

/**
 * Load state from disk, or initialize a fresh state if the file doesn't exist.
 * @returns {object} state
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle missing keys from older versions
      return {
        ...DEFAULT_STATE,
        ...parsed,
        stats: { ...DEFAULT_STATE.stats, ...(parsed.stats || {}) },
        processedHashes: parsed.processedHashes || {},
      };
    }
  } catch (err) {
    logger.warn('Could not load state file, starting fresh.', { error: err.message });
  }
  return { ...DEFAULT_STATE, processedHashes: {}, stats: { ...DEFAULT_STATE.stats } };
}

/**
 * Persist state to disk atomically via a temp-file rename.
 * @param {object} state
 */
function saveState(state) {
  const tmp = STATE_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    logger.error('Failed to save state file.', { error: err.message });
    // Remove temp file if it was created
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// In-memory cache so we don't hit disk on every check
let _state = null;

function getState() {
  if (!_state) {
    _state = loadState();
  }
  return _state;
}

/**
 * Check whether a file hash has already been processed.
 * @param {string} hash SHA256 hex
 * @returns {boolean}
 */
function isProcessed(hash) {
  return Boolean(getState().processedHashes[hash]);
}

/**
 * Record a file as processed and persist state.
 * @param {string} hash
 * @param {string} filePath
 * @param {string} uploadedAt ISO string
 */
function markProcessed(hash, filePath, uploadedAt) {
  const state = getState();
  state.processedHashes[hash] = { filePath, uploadedAt };
  state.stats.totalProcessed = Object.keys(state.processedHashes).length;
  state.stats.lastUploadAt = uploadedAt;
  saveState(state);
}

/**
 * Update the lastScanAt timestamp and persist.
 */
function markScanCompleted() {
  const state = getState();
  state.stats.lastScanAt = new Date().toISOString();
  saveState(state);
}

/**
 * Return aggregate statistics.
 * @returns {{ totalProcessed: number, lastScanAt: string|null, lastUploadAt: string|null }}
 */
function getStats() {
  return { ...getState().stats };
}

module.exports = { loadState, saveState, isProcessed, markProcessed, markScanCompleted, getStats };
