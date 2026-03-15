import mongoose from 'mongoose';

const COLLECTION = 'childsupportworksheet';

export type WorksheetData = {
  numberOfChildren?: number;
  childNames?: string[];
  childDatesOfBirth?: string[];
  parentAMonthlyGrossIncome?: number;
  parentBMonthlyGrossIncome?: number;
  overnightsParentA?: number;
  overnightsParentB?: number;
  timesharingPercentageParentA?: number;
  timesharingPercentageParentB?: number;
  healthInsuranceMonthly?: number;
  daycareMonthly?: number;
  otherChildCareMonthly?: number;
  mandatoryUnionDues?: number;
  supportPaidForOtherChildren?: number;
  [key: string]: unknown;
};

export type WorksheetDocument = {
  _id?: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  caseId?: mongoose.Types.ObjectId;
  data: WorksheetData;
  createdAt: Date;
  updatedAt: Date;
};

function filterForUserAndCase(userId: string, caseId?: string | null): Record<string, unknown> {
  const q: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(userId) };
  if (caseId && mongoose.isValidObjectId(caseId)) {
    q.caseId = new mongoose.Types.ObjectId(caseId);
  } else {
    q.$or = [{ caseId: { $exists: false } }, { caseId: null }];
  }
  return q;
}

export async function getWorksheet(userId: string, caseId?: string | null): Promise<WorksheetDocument | null> {
  const col = mongoose.connection.collection(COLLECTION);
  const doc = await col.findOne(filterForUserAndCase(userId, caseId)) as WorksheetDocument | null;
  return doc;
}

export async function putWorksheet(
  userId: string,
  data: WorksheetData,
  caseId?: string | null
): Promise<void> {
  const col = mongoose.connection.collection(COLLECTION);
  const now = new Date();
  const filter = filterForUserAndCase(userId, caseId);

  const update: Record<string, unknown> = {
    $set: {
      data,
      updatedAt: now
    }
  };

  const existing = await col.findOne(filter);
  if (existing) {
    await col.updateOne(filter, update);
  } else {
    await col.insertOne({
      userId: new mongoose.Types.ObjectId(userId),
      ...(caseId && mongoose.isValidObjectId(caseId) ? { caseId: new mongoose.Types.ObjectId(caseId) } : {}),
      data,
      createdAt: now,
      updatedAt: now
    });
  }
}
