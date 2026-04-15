import mongoose from 'mongoose';

const COLLECTION = 'childsupportworksheet';

export type WorksheetData = {
  numberOfChildren?: number;
  childNames?: string[];
  childDatesOfBirth?: string[];
  parentAMonthlyGrossIncome?: number;
  parentBMonthlyGrossIncome?: number;
  /** When set, guideline Line 1 (respondent) uses this net amount; otherwise gross field or affidavit net. */
  parentBMonthlyNetIncome?: number;
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
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
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
  caseId?: string | null,
  audit?: { updatedBy?: string | null }
): Promise<void> {
  const col = mongoose.connection.collection(COLLECTION);
  const now = new Date();
  const filter = filterForUserAndCase(userId, caseId);
  const auditOid =
    audit?.updatedBy && mongoose.isValidObjectId(audit.updatedBy)
      ? new mongoose.Types.ObjectId(audit.updatedBy)
      : null;

  const setDoc: Record<string, unknown> = {
    data,
    updatedAt: now
  };
  if (auditOid) {
    setDoc.updatedBy = auditOid;
  }

  const update: Record<string, unknown> = {
    $set: setDoc
  };

  const existing = await col.findOne(filter);
  if (existing) {
    await col.updateOne(filter, update);
  } else {
    const insertDoc: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
      ...(caseId && mongoose.isValidObjectId(caseId) ? { caseId: new mongoose.Types.ObjectId(caseId) } : {}),
      data,
      createdAt: now,
      updatedAt: now
    };
    if (auditOid) {
      insertDoc.createdBy = auditOid;
      insertDoc.updatedBy = auditOid;
    }
    await col.insertOne(insertDoc);
  }
}
