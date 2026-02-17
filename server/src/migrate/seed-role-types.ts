import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI');
}

const mongoUri: string = MONGODB_URI;

async function main() {
  await mongoose.connect(mongoUri);

  // Use a dedicated collection for role types.
  const col = mongoose.connection.collection('roletype');

  const seed = [
    { id: 1, name: 'Petitioner' },
    { id: 2, name: 'Respondent' },
    { id: 3, name: 'Petitioner Attorney' },
    { id: 4, name: 'Respondent Attorney' },
    { id: 5, name: 'Administrator' }
  ];

  for (const row of seed) {
    await col.updateOne({ id: row.id }, { $set: { ...row } }, { upsert: true });
  }

  try {
    await col.createIndex({ id: 1 }, { unique: true });
  } catch {
    // Ignore if duplicates exist; seed remains usable.
  }

  console.log(`Seeded ${seed.length} role types into collection 'roletype'.`);
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
