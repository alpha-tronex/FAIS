/**
 * Optional Amazon Textract sync OCR for document intake when pdf-parse text is weak.
 *
 * Requires a real AWS account and IAM permissions for textract:DetectDocumentText.
 * Backblaze B2 S3-compatible credentials do NOT work — set standard AWS env (see below).
 *
 * Sync DetectDocumentText supports multi-page PDFs up to 3 pages (AWS limit).
 */

import { DetectDocumentTextCommand, TextractClient } from '@aws-sdk/client-textract';

/** AWS sync DetectDocumentText PDF page limit. */
export const TEXTRACT_SYNC_MAX_PDF_PAGES = 3;

export function isTextractIntakeOcrEnabled(): boolean {
  return process.env.DOCUMENT_INTAKE_TEXTRACT === 'true';
}

/**
 * Build plain text from Textract LINE blocks (deterministic, unit-tested).
 */
export function joinTextractLineBlocks(
  blocks: Array<{ BlockType?: string; Text?: string } | undefined> | undefined
): string {
  if (!blocks?.length) return '';
  const lines: string[] = [];
  for (const b of blocks) {
    if (b?.BlockType === 'LINE' && typeof b.Text === 'string' && b.Text.length > 0) {
      lines.push(b.Text);
    }
  }
  return lines.join('\n');
}

function textractRegion(): string {
  return (
    process.env.AWS_TEXTRACT_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    'us-east-1'
  );
}

/**
 * Run synchronous DetectDocumentText on PDF bytes (≤3 pages per AWS sync rules).
 */
export async function extractTextWithTextract(pdfBuffer: Buffer): Promise<string> {
  const client = new TextractClient({ region: textractRegion() });
  const response = await client.send(
    new DetectDocumentTextCommand({
      Document: { Bytes: pdfBuffer }
    })
  );
  return joinTextractLineBlocks(response.Blocks);
}
