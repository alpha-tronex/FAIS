import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import fs from 'node:fs/promises';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI');
}

const mongoUri: string = MONGODB_URI;

type LookupSeedSpec = {
  collectionName: string;
  jsonFilename: string;
};

const LOOKUP_SEEDS: LookupSeedSpec[] = [
  { collectionName: 'lookup_divisions', jsonFilename: 'divisions.json' },
  { collectionName: 'lookup_circuits', jsonFilename: 'circuits.json' },
  { collectionName: 'lookup_counties', jsonFilename: 'counties.json' },
  { collectionName: 'lookup_states', jsonFilename: 'states.json' },
  { collectionName: 'lookup_pay_frequency_types', jsonFilename: 'pay-frequency-types.json' },
  { collectionName: 'lookup_monthly_income_types', jsonFilename: 'monthly-income-types.json' },
  { collectionName: 'lookup_monthly_deduction_types', jsonFilename: 'monthly-deduction-types.json' },
  { collectionName: 'lookup_monthly_household_expense_types', jsonFilename: 'monthly-household-expense-types.json' },
  { collectionName: 'lookup_assets_types', jsonFilename: 'assets-types.json' },
  { collectionName: 'lookup_liabilities_types', jsonFilename: 'liabilities-types.json' },
  { collectionName: 'lookup_non_marital_types', jsonFilename: 'non-marital-types.json' }
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function seedCollectionFromJson(spec: LookupSeedSpec, tablesDir: string): Promise<void> {
  const filePath = path.join(tablesDir, spec.jsonFilename);

  const col = mongoose.connection.collection(spec.collectionName);
  const existingCount = await col.countDocuments({});
  if (existingCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`[seed-lookups] ${spec.collectionName}: already has ${existingCount} docs; skipping`);
    return;
  }

  if (!(await fileExists(filePath))) {
    // eslint-disable-next-line no-console
    console.warn(`[seed-lookups] ${spec.collectionName}: missing ${filePath}; leaving empty`);
    return;
  }

  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`[seed-lookups] ${spec.collectionName}: ${spec.jsonFilename} is not a JSON array`);
  }

  if (parsed.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[seed-lookups] ${spec.collectionName}: ${spec.jsonFilename} is empty; leaving empty`);
    return;
  }

  await col.insertMany(parsed, { ordered: false });
  // eslint-disable-next-line no-console
  console.log(`[seed-lookups] ${spec.collectionName}: inserted ${parsed.length} docs from ${spec.jsonFilename}`);
}

async function main() {
  await mongoose.connect(mongoUri);

  const seedsDir = path.join(process.cwd(), 'src', 'seed', 'lookups');

  // eslint-disable-next-line no-console
  console.log(`[seed-lookups] seedsDir=${seedsDir}`);

  for (const spec of LOOKUP_SEEDS) {
    await seedCollectionFromJson(spec, seedsDir);
  }
}

main()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
    process.exit(1);
  });
