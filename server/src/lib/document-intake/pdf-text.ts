import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages?: number }>;

export async function extractPdfText(buffer: Buffer): Promise<{ text: string; numPages?: number }> {
  const result = await pdfParse(buffer);
  return { text: result.text || '', numPages: result.numpages };
}
