import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { templatePath } from './affidavit-pdf.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export type FloridaGuidelineChartRow = {
  income: number;
  columns: readonly [number, number, number, number, number, number];
};

let chartPromise: Promise<FloridaGuidelineChartRow[]> | null = null;

function fillMissingAndBrokenRows(rows: Map<number, [number, number, number, number, number, number]>): void {
  const keys = [...rows.keys()].sort((a, b) => a - b);
  if (keys.length < 2) return;
  const min = keys[0];
  const max = keys[keys.length - 1];

  for (let income = min; income <= max; income += 50) {
    if (rows.has(income)) continue;
    let lo = income - 50;
    while (lo >= min && !rows.has(lo)) lo -= 50;
    let hi = income + 50;
    while (hi <= max && !rows.has(hi)) hi += 50;
    if (!rows.has(lo) || !rows.has(hi)) continue;
    const loVals = rows.get(lo)!;
    const hiVals = rows.get(hi)!;
    const t = (income - lo) / (hi - lo);
    rows.set(
      income,
      loVals.map((v, idx) => Math.round(v + (hiVals[idx] - v) * t)) as [
        number,
        number,
        number,
        number,
        number,
        number
      ]
    );
  }

  const sorted = [...rows.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length - 1; i += 1) {
    const income = sorted[i];
    const prev = rows.get(sorted[i - 1])!;
    const cur = rows.get(income)!;
    const next = rows.get(sorted[i + 1])!;
    const broken = cur.some((v, idx) => v < prev[idx] || v > next[idx] + 500);
    if (!broken) continue;
    rows.set(
      income,
      prev.map((v, idx) => Math.round(v + (next[idx] - v) / 2)) as [
        number,
        number,
        number,
        number,
        number,
        number
      ]
    );
  }
}

async function parseChartFromTemplate(): Promise<FloridaGuidelineChartRow[]> {
  const bytes = await fs.readFile(templatePath('child-support-worksheet'));
  const parsed = await pdfParse(Buffer.from(bytes));
  const re = /(\d+\.00)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/g;
  const rows = new Map<number, [number, number, number, number, number, number]>();
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(parsed.text)) !== null) {
    const income = Number(match[1]);
    rows.set(income, [
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7])
    ]);
  }

  if (rows.size < 100) {
    throw new Error('Unable to parse Florida child support chart from worksheet template');
  }
  fillMissingAndBrokenRows(rows);
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([income, columns]) => ({ income, columns }));
}

export async function getFloridaGuidelineChart(): Promise<FloridaGuidelineChartRow[]> {
  if (!chartPromise) {
    chartPromise = parseChartFromTemplate();
  }
  return chartPromise;
}
