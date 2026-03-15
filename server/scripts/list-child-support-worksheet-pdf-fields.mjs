#!/usr/bin/env node
/**
 * Lists all form field names in the child support guidelines worksheet PDF.
 * Run from repo root: node server/scripts/list-child-support-worksheet-pdf-fields.mjs
 *
 * Use the output to map data in server/src/lib/child-support-worksheet-pdf.ts.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const templatePath = path.join(serverDir, 'private', 'forms', 'fl-child-support-guidelines-worksheet.pdf');

async function main() {
  let bytes;
  try {
    bytes = await fs.readFile(templatePath);
  } catch (e) {
    console.error('Could not read template:', templatePath);
    console.error('Place the worksheet PDF at server/private/forms/fl-child-support-guidelines-worksheet.pdf');
    process.exit(1);
  }

  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();

  const names = fields.map((f) => String(f?.getName?.() ?? '')).filter(Boolean);
  console.log('Child support worksheet PDF field count:', names.length);
  console.log('');
  console.log('--- All field names (one per line) ---');
  names.forEach((name) => console.log(name));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
