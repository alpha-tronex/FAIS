import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import fs from 'node:fs/promises';
import bcrypt from 'bcrypt';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI');
}
const mongoUri: string = MONGODB_URI;

const args = process.argv.slice(2);

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function getArg(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

type JsonSeedSpec = {
  collectionName: string;
  jsonFilename: string;
};

const JSON_SEEDS: JsonSeedSpec[] = [
  { collectionName: 'lookup_divisions', jsonFilename: 'divisions.json' },
  { collectionName: 'lookup_circuits', jsonFilename: 'circuits.json' },
  { collectionName: 'lookup_counties', jsonFilename: 'counties.json' },
  { collectionName: 'lookup_states', jsonFilename: 'states.json' },
  { collectionName: 'lookup_pay_frequency_types', jsonFilename: 'pay-frequency-types.json' },
  { collectionName: 'lookup_monthly_income_types', jsonFilename: 'monthly-income-types.json' },
  { collectionName: 'lookup_monthly_deduction_types', jsonFilename: 'monthly-deduction-types.json' },
  { collectionName: 'lookup_monthly_household_expense_types', jsonFilename: 'monthly-household-expense-types.json' },
  { collectionName: 'lookup_monthly_automobile_expense_types', jsonFilename: 'monthly-automobile-expense-types.json' },
  { collectionName: 'lookup_monthly_children_expense_types', jsonFilename: 'monthly-children-expense-types.json' },
  { collectionName: 'lookup_monthly_children_other_expense_types', jsonFilename: 'monthly-children-other-expense-types.json' },
  { collectionName: 'lookup_monthly_creditors_expense_types', jsonFilename: 'monthly-creditors-expense-types.json' },
  { collectionName: 'lookup_monthly_insurance_expense_types', jsonFilename: 'monthly-insurance-expense-types.json' },
  { collectionName: 'lookup_monthly_other_expense_types', jsonFilename: 'monthly-other-expense-types.json' },
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

async function readJsonArray(filePath: string): Promise<any[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array in ${filePath}`);
  }
  return parsed;
}

async function seedCollectionFromJson(db: mongoose.mongo.Db, spec: JsonSeedSpec, tablesDir: string): Promise<void> {
  const filePath = path.join(tablesDir, spec.jsonFilename);
  const col = db.collection(spec.collectionName);

  const existingCount = await col.countDocuments({});
  if (existingCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`[reset-clean-fais] ${spec.collectionName}: already has ${existingCount} docs; skipping`);
    return;
  }

  if (!(await fileExists(filePath))) {
    // eslint-disable-next-line no-console
    console.warn(`[reset-clean-fais] ${spec.collectionName}: missing ${filePath}; leaving empty`);
    return;
  }

  const docs = await readJsonArray(filePath);
  if (docs.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[reset-clean-fais] ${spec.collectionName}: ${spec.jsonFilename} empty; leaving empty`);
    return;
  }

  await col.insertMany(docs, { ordered: false });
  // eslint-disable-next-line no-console
  console.log(`[reset-clean-fais] ${spec.collectionName}: inserted ${docs.length} docs from ${spec.jsonFilename}`);
}

async function seedRoleTypes(db: mongoose.mongo.Db): Promise<void> {
  const col = db.collection('roletype');
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
    // ignore
  }

  // eslint-disable-next-line no-console
  console.log(`[reset-clean-fais] roletype: ensured ${seed.length} role types`);
}

async function seedInitialAdminUser(db: mongoose.mongo.Db): Promise<void> {
  const uname = process.env.SEED_ADMIN_UNAME?.trim() || 'admin';
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@local.test';
  const password = process.env.SEED_ADMIN_PASSWORD || 'local123';

  if (!process.env.SEED_ADMIN_PASSWORD) {
    // eslint-disable-next-line no-console
    console.warn('[reset-clean-fais] SEED_ADMIN_PASSWORD not set; using default local dev password');
  }

  const users = db.collection('users');
  const existing = await users.findOne({ $or: [{ uname }, { email }] });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[reset-clean-fais] users: admin user already exists (uname=${uname}); skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await users.insertOne({
    uname,
    email,
    firstName: 'Admin',
    lastName: 'User',
    roleTypeId: 5,
    passwordHash,
    mustResetPassword: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  try {
    await users.createIndex({ uname: 1 }, { unique: true });
  } catch {
    // ignore
  }
  try {
    await users.createIndex({ email: 1 }, { unique: true });
  } catch {
    // ignore
  }

  // eslint-disable-next-line no-console
  console.log(`[reset-clean-fais] users: created initial admin user (uname=${uname}, roleTypeId=5)`);
}

async function main() {
  const shouldDrop = hasFlag('--drop');
  if (!shouldDrop) {
    throw new Error('Refusing to run without --drop. This script is destructive.');
  }

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection not ready (db is undefined)');

  // eslint-disable-next-line no-console
  console.log('[reset-clean-fais] dropping database...');
  await db.dropDatabase();

  const dirArg = getArg('--dir');
  const seedsDir = dirArg
    ? path.isAbsolute(dirArg)
      ? dirArg
      : path.join(process.cwd(), dirArg)
    : path.join(process.cwd(), 'src', 'seed', 'lookups');

  // eslint-disable-next-line no-console
  console.log(`[reset-clean-fais] seedsDir=${seedsDir}`);

  for (const spec of JSON_SEEDS) {
    await seedCollectionFromJson(db, spec, seedsDir);
  }

  await seedRoleTypes(db);
  await seedInitialAdminUser(db);

  // eslint-disable-next-line no-console
  console.log('[reset-clean-fais] done');
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
