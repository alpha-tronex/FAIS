/**
 * Backblaze B2 storage via S3-compatible API.
 * Env: B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME, B2_ENDPOINT (e.g. s3.us-west-004.backblazeb2.com)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PDF_MIME = 'application/pdf';
const DEFAULT_PRESIGN_EXPIRES = 300; // 5 minutes

let client: S3Client | null = null;

/** Rethrow with a clear message if this is the common B2 credential mix-up. */
function wrapB2CredentialError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Malformed Access Key Id|InvalidAccessKeyId|access key/i.test(msg)) {
    throw new Error(
      'B2_KEY_ID must be the short Key ID from Backblaze (e.g. 005...), not the long application key. ' +
        'In B2: Application Keys → keyID → B2_KEY_ID; applicationKey → B2_APP_KEY.'
    );
  }
  throw err;
}

function getB2Config(): { bucket: string; client: S3Client } {
  const keyId = process.env.B2_KEY_ID?.trim() ?? '';
  const appKey = process.env.B2_APP_KEY?.trim() ?? '';
  const bucket = process.env.B2_BUCKET_NAME?.trim() ?? '';
  const endpoint = process.env.B2_ENDPOINT?.trim() ?? '';

  if (!keyId || !appKey || !bucket || !endpoint) {
    throw new Error(
      'B2 storage requires B2_KEY_ID, B2_APP_KEY, B2_BUCKET_NAME, B2_ENDPOINT in environment'
    );
  }

  if (!client) {
    const region = process.env.B2_REGION?.trim() || endpoint.replace(/^s3\.([^.]+)\..*/, '$1') || 'us-west-004';
    client = new S3Client({
      endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
      region,
      credentials: { accessKeyId: keyId, secretAccessKey: appKey },
      forcePathStyle: true,
    });
  }

  return { bucket, client };
}

/** Upload a buffer to B2. Key e.g. documents/{documentId}.pdf */
export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string = PDF_MIME
): Promise<void> {
  const { bucket, client: c } = getB2Config();
  try {
    await c.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
  } catch (e) {
    wrapB2CredentialError(e);
  }
}

/** Get object body from B2 as Buffer. */
export async function getObject(key: string): Promise<Buffer> {
  const { bucket, client: c } = getB2Config();
  try {
    const response = await c.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const stream = response.Body;
    if (!stream) throw new Error('Empty response body from B2');
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    wrapB2CredentialError(e);
  }
}

/** Delete object from B2. */
export async function deleteObject(key: string): Promise<void> {
  const { bucket, client: c } = getB2Config();
  try {
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    wrapB2CredentialError(e);
  }
}

/** Get a presigned GET URL for download (Option B). */
export async function getPresignedGetUrl(
  key: string,
  expiresInSeconds: number = DEFAULT_PRESIGN_EXPIRES
): Promise<string> {
  const { bucket, client: c } = getB2Config();
  try {
    return await getSignedUrl(
      c,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresInSeconds }
    );
  } catch (e) {
    wrapB2CredentialError(e);
  }
}

/** Check if B2 is configured (for conditional feature availability). */
export function isB2Configured(): boolean {
  try {
    getB2Config();
    return true;
  } catch {
    return false;
  }
}
