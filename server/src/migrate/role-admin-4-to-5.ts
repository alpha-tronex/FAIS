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

  const users = mongoose.connection.collection('users');
  const before = await users.countDocuments({ roleTypeId: 4 });
  const res = await users.updateMany({ roleTypeId: 4 }, { $set: { roleTypeId: 5 } });

  const after = await users.countDocuments({ roleTypeId: 4 });
  const admins = await users.countDocuments({ roleTypeId: 5 });

  console.log(
    JSON.stringify(
      {
        ok: true,
        matched: res.matchedCount,
        modified: res.modifiedCount,
        adminsRole4Before: before,
        adminsRole4After: after,
        adminsRole5Now: admins
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
