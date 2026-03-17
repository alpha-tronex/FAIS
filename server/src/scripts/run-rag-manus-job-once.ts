/**
 * Run the RAG example Manus job once (for testing).
 * Requires: MONGODB_URI, MANUS_API_KEY in env (e.g. server/.env).
 *
 * Usage: npm run run:rag-manus-once   (from server/)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { runRagExampleManusJobOnce } from '../jobs/rag-example-manus.job.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const mongoUri = process.env.MONGODB_URI?.trim();
if (!mongoUri) {
  console.error('Missing MONGODB_URI');
  process.exitCode = 1;
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri as string);
  await runRagExampleManusJobOnce();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
  });
