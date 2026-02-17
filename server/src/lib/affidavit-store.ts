import mongoose from 'mongoose';

export function userScopedFilter(targetUserObjectId: string): any {
  return { userId: new mongoose.Types.ObjectId(targetUserObjectId) };
}

export async function listAffidavitRows(collectionName: string, filter: any): Promise<any[]> {
  try {
    return await mongoose.connection.collection(collectionName).find(filter).toArray();
  } catch {
    return [];
  }
}

export async function insertAffidavitRow(collectionName: string, doc: any): Promise<string> {
  const res = await mongoose.connection.collection(collectionName).insertOne(doc);
  return res.insertedId.toString();
}

export async function deleteAffidavitRow(collectionName: string, id: string, filter: any): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const _id = new mongoose.Types.ObjectId(id);
  const scoped = { $and: [{ _id }, filter] };

  const found = await mongoose.connection.collection(collectionName).findOne(scoped);
  if (!found) return false;
  const res = await mongoose.connection.collection(collectionName).deleteOne({ _id });
  return res.deletedCount === 1;
}

export async function patchAffidavitRow(collectionName: string, id: string, filter: any, set: any): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const _id = new mongoose.Types.ObjectId(id);
  const scoped = { $and: [{ _id }, filter] };

  const res = await mongoose.connection.collection(collectionName).updateOne(scoped, { $set: set });
  return res.matchedCount === 1;
}

export async function sumMonthlyIncomeForUser(userObjectId: string): Promise<number> {
  const collectionName = 'monthlyincome';
  const col = mongoose.connection.collection(collectionName);

  const rows = await col
    .aggregate([
      { $match: userScopedFilter(userObjectId) },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$amount', 0] } }
        }
      }
    ])
    .toArray();

  const total = (rows as any)?.[0]?.total;
  const n = Number(total);
  if (Number.isFinite(n)) return n;
  return 0;
}

export async function listEmploymentRowsForUser(userObjectId: string): Promise<any[]> {
  try {
    return await mongoose.connection.collection('employment').find(userScopedFilter(userObjectId)).toArray();
  } catch {
    return [];
  }
}
