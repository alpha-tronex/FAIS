import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('Missing MONGODB_URI');
  process.exit(2);
}

const password = process.argv[2] ?? 'local123';

function asNonEmptyString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

await mongoose.connect(mongoUri);

try {
  const users = mongoose.connection.collection('users');

  const hash = await bcrypt.hash(password, 12);

  const cursor = users.find({});
  const ops = [];

  let total = 0;
  let updated = 0;
  let skippedNoUname = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) break;
    total += 1;

    const uname = asNonEmptyString(doc.uname) ?? asNonEmptyString(doc.Uname);
    if (!uname) {
      skippedNoUname += 1;
      continue;
    }

    const email =
      asNonEmptyString(doc.email) ??
      asNonEmptyString(doc.Email) ??
      `${uname}.${String(doc._id)}@local.invalid`;

    const roleTypeIdRaw = doc.roleTypeId ?? doc.RoleTypeID;
    const roleTypeId = Number.isFinite(Number(roleTypeIdRaw)) ? Number(roleTypeIdRaw) : 1;

    const fname = asNonEmptyString(doc.fname) ?? asNonEmptyString(doc.Fname) ?? undefined;
    const lname = asNonEmptyString(doc.lname) ?? asNonEmptyString(doc.Lname) ?? undefined;

    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            uname,
            email,
            roleTypeId,
            ...(fname ? { fname } : {}),
            ...(lname ? { lname } : {}),
            passwordHash: hash,
            mustResetPassword: false
          }
        }
      }
    });

    if (ops.length >= 500) {
      const res = await users.bulkWrite(ops, { ordered: false });
      updated += (res.modifiedCount ?? 0);
      ops.length = 0;
    }
  }

  if (ops.length > 0) {
    const res = await users.bulkWrite(ops, { ordered: false });
    updated += (res.modifiedCount ?? 0);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        db: mongoose.connection.name,
        total,
        updated,
        skippedNoUname,
        passwordSetTo: password
      },
      null,
      2
    )
  );
} finally {
  await mongoose.disconnect();
}
