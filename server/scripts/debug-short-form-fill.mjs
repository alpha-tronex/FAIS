#!/usr/bin/env node
/**
 * Debug short-form PDF: list asset/liability field names and types, then try to fill and save.
 * Run from server: node scripts/debug-short-form-fill.mjs
 * Output: writes server/private/forms/debug-filled-short.pdf
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const templatePath = path.join(serverDir, 'private', 'forms', 'fl-financial-affidavit-short.pdf');
const outPath = path.join(serverDir, 'private', 'forms', 'debug-filled-short.pdf');

async function main() {
  const bytes = await fs.readFile(templatePath);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();

  console.log('Total fields:', fields.length);

  // List fields that look like asset/liability (cash, bank, total assets, total debts, check box for those)
  const needles = ['cash on hand', 'cash in banks', 'total assets', 'total debts', 'current fair market value', 'current amount owed'];
  const relevant = fields.filter((f) => {
    const name = String(f?.getName?.() ?? '').toLowerCase();
    return needles.some((n) => name.includes(n)) || name.includes('check box');
  });

  console.log('\n--- Asset/liability-related fields (name + type) ---');
  const type = (f) => {
    if (typeof f.setText === 'function') return 'TEXT';
    if (typeof f.check === 'function') return 'CHECK';
    return 'OTHER';
  };
  for (const f of relevant.slice(0, 40)) {
    const name = f.getName();
    console.log(`${type(f).padEnd(6)} ${name}`);
  }

  // Build list like the server: { name, field }
  const allFormFields = fields.map((f) => ({ name: String(f?.getName?.() ?? ''), field: f })).filter((x) => x.name);

  function setShortFormText(needle, value, excludeSubstring) {
    const n = String(needle ?? '').trim().toLowerCase();
    if (!n) return false;
    const exclude = (excludeSubstring ?? '').toLowerCase();
    const entry = allFormFields.find((x) => {
      const nameLower = x.name.toLowerCase();
      if (!nameLower.includes(n) || (exclude && nameLower.includes(exclude))) return false;
      return typeof x.field.setText === 'function';
    });
    if (entry && value !== undefined) {
      entry.field.setText(value);
      console.log('  SET TEXT:', entry.name, '->', value);
      return true;
    }
    console.log('  NOT FOUND (text):', needle);
    return false;
  }

  function setShortFormCheck(needle, checked) {
    const n = String(needle ?? '').trim().toLowerCase();
    if (!n) return false;
    const entry = allFormFields.find((x) => x.name.toLowerCase().includes(n) && typeof x.field.check === 'function');
    if (entry) {
      if (checked) entry.field.check();
      else entry.field.uncheck();
      console.log('  CHECK:', entry.name, '->', checked);
      return true;
    }
    console.log('  NOT FOUND (check):', needle);
    return false;
  }

  console.log('\n--- Attempting to set cash on hand and total assets ---');
  setShortFormCheck('cash on hand check box', true);
  setShortFormText('cash on hand current fair market value', '1234.56');
  setShortFormText('total assets current fair market value', '9999.00');
  setShortFormCheck('total assets petitioner check box', true);
  setShortFormText('total debts current amount owed', '500.00');
  setShortFormCheck('total debts petitioner check box', true);

  // Simulate server: strip first 3 pages AFTER filling (like the server does)
  const totalPages = pdf.getPageCount();
  console.log('\nPage count before strip:', totalPages);
  for (let i = 0; i < 3 && pdf.getPageCount() > 0; i++) {
    pdf.removePage(0);
  }
  console.log('Page count after strip:', pdf.getPageCount());
  console.log('(Assets were on original page 7 = index 6; after strip that becomes page 4 = index 3)');

  const outBytes = await pdf.save();
  await fs.writeFile(outPath, outBytes);
  console.log('\nWrote:', outPath);
  console.log('Open that PDF: asset/liability values should now be on pages 4–5 (formerly 7–8).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
