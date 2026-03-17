/**
 * Append-only file logger for the RAG Manus job. Writes to server/logs/rag-manus-job.log.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'rag-manus-job.log');

function ensureDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

export function log(message: string): void {
  ensureDir();
  const line = `${timestamp()} ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // fallback to console if file write fails
    // eslint-disable-next-line no-console
    console.log(message);
  }
}

export function logError(message: string, err?: unknown): void {
  ensureDir();
  const errStr = err instanceof Error ? err.message : err != null ? String(err) : '';
  const line = `${timestamp()} [ERROR] ${message}${errStr ? ' ' + errStr : ''}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // eslint-disable-next-line no-console
    console.error(message, err);
  }
}
