import crypto from 'crypto';

export type EncryptedSsn = {
  ssnCiphertextB64: string;
  ssnIvB64: string;
  ssnAuthTagB64: string;
};

export function computeSsnLast4(ssn: string): string {
  const digits = ssn.replace(/\D/g, '');
  return digits.slice(-4);
}

function getKey(): Buffer {
  const keyB64 = process.env.SSN_ENCRYPTION_KEY_B64;
  if (!keyB64) {
    throw new Error('SSN_ENCRYPTION_KEY_B64 is not set');
  }

  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('SSN_ENCRYPTION_KEY_B64 must decode to 32 bytes (AES-256 key)');
  }

  return key;
}

export function encryptSsn(plainSsn: string): EncryptedSsn {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(plainSsn, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ssnCiphertextB64: ciphertext.toString('base64'),
    ssnIvB64: iv.toString('base64'),
    ssnAuthTagB64: authTag.toString('base64')
  };
}

export function decryptSsn(enc: EncryptedSsn): string {
  const key = getKey();
  const iv = Buffer.from(enc.ssnIvB64, 'base64');
  const authTag = Buffer.from(enc.ssnAuthTagB64, 'base64');
  const ciphertext = Buffer.from(enc.ssnCiphertextB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
