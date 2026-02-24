import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { PDFDocument } from 'pdf-lib';

export type PdfTemplateKey = 'short' | 'long';

// Resolve relative to this file so template is found whether server runs from repo root or server dir
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'private', 'forms');

export function templatePath(key: PdfTemplateKey): string {
  const filename = key === 'short' ? 'fl-financial-affidavit-short.pdf' : 'fl-financial-affidavit-long.pdf';
  return path.join(PDF_TEMPLATES_DIR, filename);
}

export async function loadTemplatePdf(key: PdfTemplateKey): Promise<PDFDocument> {
  const p = templatePath(key);
  try {
    const bytes = await fs.readFile(p);
    return await PDFDocument.load(bytes);
  } catch (e: unknown) {
    const err = new Error(
      `Missing PDF template file: ${p}. Place the official form PDFs under server/private/forms/.`
    );
    (err as { status?: number }).status = 500;
    throw err;
  }
}

export function stripLeadingInstructionPages(pdf: PDFDocument, count: number): void {
  const total = pdf.getPageCount();
  const toRemove = Math.min(Math.max(count, 0), total);
  for (let i = 0; i < toRemove; i += 1) {
    pdf.removePage(0);
  }
}

export function setTextIfExists(form: { getTextField: (name: string) => { setText: (v: string) => void } }, fieldName: string, value: string): void {
  try {
    const f = form.getTextField(fieldName);
    f.setText(value);
  } catch {
    // Ignore missing fields; templates vary by revision.
  }
}

export function checkIfExists(
  form: { getCheckBox: (name: string) => { check: () => void; uncheck: () => void } },
  fieldName: string,
  checked: boolean
): void {
  try {
    const f = form.getCheckBox(fieldName);
    if (checked) f.check();
    else f.uncheck();
  } catch {
    // Ignore missing fields
  }
}

/** Format for display (e.g. HTML): $1,234.56 */
export function formatMoney(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Format for PDF form fields: 1234.56 (no currency symbol) */
export function formatMoneyDecimal(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
}

export function escapeHtml(input: unknown): string {
  const s = String(input ?? '');
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function lookupName(collectionName: string, id: number | null | undefined): Promise<string> {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return '';
  const row = await mongoose
    .connection
    .collection(collectionName)
    .findOne({ id: n }, { projection: { name: 1 } });
  return String((row as { name?: string } | null)?.name ?? '').trim();
}

export function payFrequencyToAnnualMultiplier(payFrequencyTypeId: number | null): number | null {
  switch (payFrequencyTypeId) {
    case 1:
      return 52; // Weekly
    case 2:
      return 26; // Bi-Weekly
    case 3:
      return 12; // Monthly
    case 4:
      return 24; // Bi-Monthly (twice/month)
    case 5:
      return 1; // Annually
    case 6:
      return 2; // Semi-Annually
    case 7:
      return 4; // Quarterly
    case 8:
      return 260; // Daily (assume 5 days/week)
    case 9:
      return 2080; // Hourly (assume 40 hrs/week)
    default:
      return null;
  }
}
