/**
 * One-off migration: update lookup_non_marital_types labels from
 * "Husband"/"Wife" to "Petitioner"/"Respondent".
 *
 * Run from server directory: npx ts-node src/migrate/update-non-marital-types-names.ts
 * (or via tsx/ts-node with proper path to .env)
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI');
}

const COLLECTION = 'lookup_non_marital_types';

async function main() {
  await mongoose.connect(MONGODB_URI);

  const col = mongoose.connection.collection(COLLECTION);

  const r1 = await col.updateOne({ id: 1 }, { $set: { name: 'Petitioner' } });
  const r2 = await col.updateOne({ id: 2 }, { $set: { name: 'Respondent' } });

  console.log(
    JSON.stringify(
      {
        ok: true,
        id1: { matched: r1.matchedCount, modified: r1.modifiedCount, name: 'Petitioner' },
        id2: { matched: r2.matchedCount, modified: r2.modifiedCount, name: 'Respondent' }
      },
      null,
      2
    )
  );
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
