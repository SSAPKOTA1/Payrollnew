'use strict';

// ── Bootstrap ─────────────────────────────────────────────────────────────────
require('dotenv').config();

const path = require('path');
const chokidar = require('chokidar');
const cron = require('node-cron');

const logger = require('./logger');
const { scanDirectory, shouldProcessFile } = require('./scanner');
const { classifyFile } = require('./classifier');
const { uploadFile } = require('./uploader');
const { markScanCompleted, getStats } = require('./state');

// ── Config ────────────────────────────────────────────────────────────────────
const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const AGENT_API_KEY = process.env.AGENT_API_KEY || '';
const SCAN_ROOT = process.env.SCAN_ROOT || 'D:\\';
const SCAN_INTERVAL_MINUTES = Math.max(1, parseInt(process.env.SCAN_INTERVAL_MINUTES || '5', 10));
const SUPPORTED_EXTENSIONS = (process.env.SUPPORTED_EXTENSIONS || '.csv,.CSV')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

// Guard against missing API key in production
if (!AGENT_API_KEY) {
  logger.warn('AGENT_API_KEY is not set. Uploads will likely be rejected by the server.');
}

// ── Core: process a single file ───────────────────────────────────────────────
/**
 * Classify and upload one file.
 * Errors are caught here so a single bad file never stops the batch.
 *
 * @param {string} filePath
 */
async function processFile(filePath) {
  const ext = path.extname(filePath);

  if (!shouldProcessFile(filePath, ext, SUPPORTED_EXTENSIONS)) {
    return;
  }

  logger.info(`Processing: ${filePath}`);

  // Classify
  let classification;
  try {
    classification = classifyFile(filePath);
  } catch (err) {
    logger.error(`Classification failed for ${filePath}`, err);
    classification = { type: 'UNKNOWN', confidence: 0, detectedCompany: null };
  }

  const { type, confidence, detectedCompany } = classification;
  logger.info(`Classified as ${type} (confidence ${confidence})`, {
    filePath,
    detectedCompany,
  });

  // Upload
  try {
    const result = await uploadFile(filePath, type, detectedCompany, API_URL, AGENT_API_KEY);

    if (result.skipped) {
      logger.info(`Skipped (already uploaded): ${filePath}`);
    } else if (result.success) {
      logger.info(`Uploaded successfully: ${filePath}`, {
        fileId: result.fileId,
        rowCount: result.rowCount,
      });
    } else {
      logger.error(`Upload failed: ${filePath}`, { error: result.error });
    }
  } catch (err) {
    logger.error(`Unexpected upload error for ${filePath}`, err);
  }
}

// ── Full scan ─────────────────────────────────────────────────────────────────
async function runFullScan() {
  logger.info(`=== Full scan started: ${SCAN_ROOT} ===`);
  const startTime = Date.now();

  let files;
  try {
    files = scanDirectory(SCAN_ROOT);
  } catch (err) {
    logger.error('scanDirectory failed', err);
    return;
  }

  const eligible = files.filter((f) =>
    shouldProcessFile(f.filePath, f.extension, SUPPORTED_EXTENSIONS)
  );

  logger.info(`Found ${eligible.length} eligible file(s) of ${files.length} total.`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of eligible) {
    try {
      const ext = file.extension;
      if (!shouldProcessFile(file.filePath, ext, SUPPORTED_EXTENSIONS)) {
        skipped++;
        continue;
      }

      let classification;
      try {
        classification = classifyFile(file.filePath);
      } catch {
        classification = { type: 'UNKNOWN', confidence: 0, detectedCompany: null };
      }

      const result = await uploadFile(
        file.filePath,
        classification.type,
        classification.detectedCompany,
        API_URL,
        AGENT_API_KEY
      );

      if (result.skipped) {
        skipped++;
      } else if (result.success) {
        processed++;
        logger.info(`[scan] Uploaded: ${file.relativePath}`, {
          type: classification.type,
          fileId: result.fileId,
        });
      } else {
        failed++;
        logger.error(`[scan] Upload failed: ${file.relativePath}`, { error: result.error });
      }
    } catch (err) {
      failed++;
      logger.error(`[scan] Unexpected error for ${file.filePath}`, err);
    }
  }

  markScanCompleted();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = getStats();

  logger.info(`=== Full scan complete in ${elapsed}s ===`, {
    processed,
    skipped,
    failed,
    totalProcessedAllTime: stats.totalProcessed,
  });
}

// ── Chokidar watcher ──────────────────────────────────────────────────────────
function startWatcher() {
  logger.info(`Starting file watcher on: ${SCAN_ROOT}`);

  const watcher = chokidar.watch(SCAN_ROOT, {
    persistent: true,
    ignoreInitial: true, // initial scan is handled by runFullScan()
    followSymlinks: false,
    depth: 99,
    awaitWriteFinish: {
      stabilityThreshold: 2000, // wait 2s after last write before firing
      pollInterval: 500,
    },
    ignored: [
      // Windows system folders
      /[/\\]\$Recycle\.Bin[/\\]/,
      /[/\\]System Volume Information[/\\]/,
      /[/\\]Windows[/\\]/,
      /[/\\]Program Files[/\\]/,
      /[/\\]Program Files \(x86\)[/\\]/,
      /[/\\]ProgramData[/\\]/,
      /[/\\]AppData[/\\]/,
      /[/\\]node_modules[/\\]/,
      /[/\\]\.git[/\\]/,
      // The agent's own state file
      /\.payrollsync-state\.json/,
    ],
  });

  watcher.on('add', (filePath) => {
    logger.info(`[watcher] New file detected: ${filePath}`);
    processFile(filePath).catch((err) =>
      logger.error(`[watcher] processFile error: ${filePath}`, err)
    );
  });

  watcher.on('change', (filePath) => {
    logger.info(`[watcher] File changed: ${filePath}`);
    processFile(filePath).catch((err) =>
      logger.error(`[watcher] processFile error: ${filePath}`, err)
    );
  });

  watcher.on('error', (err) => {
    logger.error('[watcher] Watcher error', err);
  });

  watcher.on('ready', () => {
    logger.info('[watcher] Initial scan complete, now watching for changes.');
  });

  return watcher;
}

// ── Cron schedule ─────────────────────────────────────────────────────────────
function startCron() {
  // node-cron expression: run every N minutes
  // "*/N * * * *"  — every N minutes past the hour
  // For intervals > 59 min we fall back to hourly (edge case, not expected)
  const expr =
    SCAN_INTERVAL_MINUTES <= 59
      ? `*/${SCAN_INTERVAL_MINUTES} * * * *`
      : '0 * * * *'; // every hour

  logger.info(`Scheduling full scan every ${SCAN_INTERVAL_MINUTES} minute(s). Cron: "${expr}"`);

  cron.schedule(expr, () => {
    logger.info('[cron] Triggered scheduled full scan.');
    runFullScan().catch((err) => logger.error('[cron] runFullScan error', err));
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let _watcher = null;

function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully…`);
  if (_watcher) {
    _watcher.close().then(() => {
      logger.info('File watcher closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  // Keep running – do not crash the agent on a single unexpected error
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  logger.info('========================================');
  logger.info('  PayrollSync Ingestion Agent starting  ');
  logger.info('========================================');
  logger.info('Configuration', {
    API_URL,
    SCAN_ROOT,
    SCAN_INTERVAL_MINUTES,
    SUPPORTED_EXTENSIONS,
    hasApiKey: Boolean(AGENT_API_KEY),
  });

  // 1. Run an immediate full scan on startup
  await runFullScan();

  // 2. Start the file-system watcher for real-time detection
  _watcher = startWatcher();

  // 3. Start the cron for periodic full scans (catches moved/renamed files the
  //    watcher might miss, and handles cases where the agent was offline)
  startCron();

  logger.info('Agent is running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  logger.error('Fatal error during startup', err);
  process.exit(1);
});
