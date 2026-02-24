#!/usr/bin/env node
/**
 * Lists all form field names in the short-form financial affidavit PDF.
 * Run from server directory: node scripts/list-short-form-pdf-fields.mjs
 *
 * Use this to see the exact field names for assets/liabilities so we can
 * map them in affidavit-official-pdf.ts.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const templatePath = path.join(serverDir, 'private', 'forms', 'fl-financial-affidavit-short.pdf');

async function main() {
  let bytes;
  try {
    bytes = await fs.readFile(templatePath);
  } catch (e) {
    console.error('Could not read template:', templatePath);
    console.error('Place the short form PDF at server/private/forms/fl-financial-affidavit-short.pdf');
    process.exit(1);
  }

  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();

  const names = fields.map((f) => String(f?.getName?.() ?? '')).filter(Boolean);
  const assetOrLiability = (name) => {
    const n = name.toLowerCase();
    return n.includes('asset') || n.includes('liab') || n.includes('liability') || n.includes('debt') || n.includes('total');
  };

  console.log('Short form PDF field count:', names.length);
  console.log('');
  console.log('--- All field names (one per line) ---');
  names.forEach((name) => console.log(name));
  console.log('');
  console.log('--- Fields that might be assets/liabilities (contain asset, liab, liability, debt, total) ---');
  const relevant = names.filter(assetOrLiability);
  if (relevant.length) {
    relevant.forEach((name) => console.log(name));
  } else {
    console.log('(none found – template may use different names or have no fillable fields for assets/liabilities)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
