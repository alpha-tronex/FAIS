import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { User } from '../models.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI');
}
const mongoUri: string = MONGODB_URI;

async function main() {
  await mongoose.connect(mongoUri);

  const uname = process.env.SEED_ADMIN_UNAME?.trim() || 'admin';
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@local.test';
  const password = process.env.SEED_ADMIN_PASSWORD || 'local123';

  if (!process.env.SEED_ADMIN_PASSWORD) {
    // eslint-disable-next-line no-console
    console.warn('[seed-admin-user] SEED_ADMIN_PASSWORD not set; using default local dev password');
  }

  const existing = await User.findOne({ $or: [{ uname }, { email }], passwordHash: { $exists: true } }).lean();
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[seed-admin-user] Admin already exists (uname=${uname}); skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await User.create({
    uname,
    email,
    firstName: 'Admin',
    lastName: 'User',
    roleTypeId: 5,
    passwordHash,
    mustResetPassword: false
  });

  // eslint-disable-next-line no-console
  console.log(`[seed-admin-user] Created admin user (uname=${uname}, roleTypeId=5)`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
  });
