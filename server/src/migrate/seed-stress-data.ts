/**
 * Stress-test seed: 50 petitioners (with affidavit data), 50 respondents,
 * 5 petitioner attorneys, 5 respondent attorneys, and 50 cases linking them.
 * All user passwords: local123.
 * Run after lookups are seeded (e.g. migrate:reset:clean or migrate:seed:lookups).
 * Usage: npm run seed:stress (from server dir), with MONGODB_URI in env.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { User } from '../models.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI?.trim();
if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI');
}

const STRESS_PASSWORD = 'local123';
const NUM_PETITIONERS = 50;
const NUM_RESPONDENTS = 50;
const NUM_PETITIONER_ATTORNEYS = 5;
const NUM_RESPONDENT_ATTORNEYS = 5;

async function ensureAdmin(): Promise<mongoose.Types.ObjectId> {
  const admin = await User.findOne({ roleTypeId: 5 }).select('_id').lean();
  if (!admin) {
    throw new Error(
      'No admin user (roleTypeId 5) found. Run migrate:seed:admin or migrate:reset:clean first.'
    );
  }
  return admin._id as mongoose.Types.ObjectId;
}

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI!);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection not ready');

  const adminId = await ensureAdmin();
  console.log('[seed-stress] Using admin as createdBy:', adminId.toString());

  const passwordHash = await bcrypt.hash(STRESS_PASSWORD, 12);
  const now = new Date();

  // 1. Create 50 petitioners (full users, can log in)
  const petitionerIds: mongoose.Types.ObjectId[] = [];
  for (let i = 1; i <= NUM_PETITIONERS; i++) {
    const uname = `stress-petitioner-${i}`;
    const existing = await User.findOne({ uname }).select('_id').lean();
    if (existing) {
      petitionerIds.push(existing._id as mongoose.Types.ObjectId);
      continue;
    }
    const u = await User.create({
      uname,
      email: `${uname}@stress.local`,
      firstName: `Petitioner`,
      lastName: `Stress${i}`,
      roleTypeId: 1,
      passwordHash,
      mustResetPassword: false,
      createdBy: adminId,
      updatedBy: adminId,
    });
    petitionerIds.push(u._id as mongoose.Types.ObjectId);
  }
  console.log('[seed-stress] Petitioners:', petitionerIds.length);

  // 2. Create 50 respondents (minimal users)
  const respondentIds: mongoose.Types.ObjectId[] = [];
  for (let i = 1; i <= NUM_RESPONDENTS; i++) {
    const uname = `stress-respondent-${i}`;
    const existing = await User.findOne({ uname }).select('_id').lean();
    if (existing) {
      respondentIds.push(existing._id as mongoose.Types.ObjectId);
      continue;
    }
    const u = await User.create({
      uname,
      email: `${uname}@stress.local`,
      firstName: `Respondent`,
      lastName: `Stress${i}`,
      roleTypeId: 2,
      createdBy: adminId,
      updatedBy: adminId,
    });
    respondentIds.push(u._id as mongoose.Types.ObjectId);
  }
  console.log('[seed-stress] Respondents:', respondentIds.length);

  // 3. Create 5 petitioner attorneys (full users)
  const petitionerAttIds: mongoose.Types.ObjectId[] = [];
  for (let i = 1; i <= NUM_PETITIONER_ATTORNEYS; i++) {
    const uname = `stress-pet-att-${i}`;
    const existing = await User.findOne({ uname }).select('_id').lean();
    if (existing) {
      petitionerAttIds.push(existing._id as mongoose.Types.ObjectId);
      continue;
    }
    const u = await User.create({
      uname,
      email: `${uname}@stress.local`,
      firstName: `PetAttorney`,
      lastName: `Stress${i}`,
      roleTypeId: 3,
      passwordHash,
      mustResetPassword: false,
      createdBy: adminId,
      updatedBy: adminId,
    });
    petitionerAttIds.push(u._id as mongoose.Types.ObjectId);
  }
  console.log('[seed-stress] Petitioner attorneys:', petitionerAttIds.length);

  // 4. Create 5 respondent attorneys (minimal)
  const respondentAttIds: mongoose.Types.ObjectId[] = [];
  for (let i = 1; i <= NUM_RESPONDENT_ATTORNEYS; i++) {
    const uname = `stress-resp-att-${i}`;
    const existing = await User.findOne({ uname }).select('_id').lean();
    if (existing) {
      respondentAttIds.push(existing._id as mongoose.Types.ObjectId);
      continue;
    }
    const u = await User.create({
      uname,
      email: `${uname}@stress.local`,
      firstName: `RespAttorney`,
      lastName: `Stress${i}`,
      roleTypeId: 4,
      createdBy: adminId,
      updatedBy: adminId,
    });
    respondentAttIds.push(u._id as mongoose.Types.ObjectId);
  }
  console.log('[seed-stress] Respondent attorneys:', respondentAttIds.length);

  // 5. Get one county for cases (countyId + circuitId must match)
  const county = await db.collection('lookup_counties').findOne({});
  if (!county || typeof (county as any).id !== 'number' || typeof (county as any).circuitId !== 'number') {
    throw new Error('lookup_counties is empty or invalid. Run migrate:seed:lookups or migrate:reset:clean first.');
  }
  const countyId = (county as any).id as number;
  const circuitId = (county as any).circuitId as number;
  console.log('[seed-stress] Using countyId:', countyId, 'circuitId:', circuitId);

  // 6. Create 50 cases (petitioner i + respondent i; spread attorneys)
  const casesCol = db.collection('case');
  for (let i = 0; i < NUM_PETITIONERS; i++) {
    const caseNumber = `STRESS-2025-${String(i + 1).padStart(5, '0')}`;
    const existing = await casesCol.findOne({ caseNumber });
    if (existing) continue;

    const petitionerAttIndex = i % NUM_PETITIONER_ATTORNEYS;
    const respondentAttIndex = i % NUM_RESPONDENT_ATTORNEYS;
    await casesCol.insertOne({
      caseNumber,
      division: 'Family',
      circuitId,
      countyId,
      numChildren: i % 4,
      childSupportWorksheetFiled: false,
      formTypeId: 1,
      petitionerId: petitionerIds[i],
      respondentId: respondentIds[i],
      petitionerAttId: petitionerAttIds[petitionerAttIndex],
      respondentAttId: respondentAttIds[respondentAttIndex],
      legalAssistantId: null,
      createdByUserId: adminId,
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log('[seed-stress] Cases: 50');

  // 7. Affidavit data for each petitioner: employment, income, expenses, assets, liabilities
  const payFrequencyTypeId = 3; // Monthly
  const monthlyIncomeTypeId = 1; // Monthly gross salary
  const deductionTypeId = 1;
  const householdExpenseTypeId = 1;
  const autoExpenseTypeId = 1;
  const otherExpenseTypeId = 1;
  const assetsTypeId = 1; // Cash (on hand)
  const liabilitiesTypeId = 4; // Charge/credit card

  for (let i = 0; i < petitionerIds.length; i++) {
    const userId = petitionerIds[i];
    const basePay = 2500 + (i % 20) * 200;
    const baseExpense = 800 + (i % 10) * 50;

    // Employment (1–2 jobs)
    const employmentCol = db.collection('employment');
    const existingEmp = await employmentCol.findOne({ userId });
    if (!existingEmp) {
      await employmentCol.insertOne({
        userId,
        name: `Employer ${i + 1} Inc`,
        occupation: i % 2 === 0 ? 'Clerk' : 'Technician',
        payRate: basePay,
        payFrequencyTypeId,
        payFrequencyIfOther: null,
        retired: false,
        createdAt: now,
      });
      if (i % 3 === 0) {
        await employmentCol.insertOne({
          userId,
          name: `Side Job ${i + 1}`,
          occupation: 'Part-time',
          payRate: 400,
          payFrequencyTypeId,
          retired: false,
          createdAt: now,
        });
      }
    }

    // Monthly income
    const incomeCol = db.collection('monthlyincome');
    const existingInc = await incomeCol.findOne({ userId });
    if (!existingInc) {
      await incomeCol.insertOne({
        userId,
        typeId: monthlyIncomeTypeId,
        amount: basePay,
        ifOther: null,
        createdAt: now,
      });
    }

    // Monthly deductions
    const dedCol = db.collection('monthlydeductions');
    const existingDed = await dedCol.findOne({ userId });
    if (!existingDed) {
      await dedCol.insertOne({
        userId,
        typeId: deductionTypeId,
        amount: Math.round(basePay * 0.15),
        ifOther: null,
        createdAt: now,
      });
    }

    // Monthly household expense
    const houseCol = db.collection('monthlyhouseholdexpense');
    const existingHouse = await houseCol.findOne({ userId });
    if (!existingHouse) {
      await houseCol.insertOne({
        userId,
        typeId: householdExpenseTypeId,
        amount: baseExpense,
        ifOther: null,
        createdAt: now,
      });
    }

    // Monthly automobile expense
    const autoCol = db.collection('monthlyautomobileexpense');
    const existingAuto = await autoCol.findOne({ userId });
    if (!existingAuto) {
      await autoCol.insertOne({
        userId,
        typeId: autoExpenseTypeId,
        amount: 150 + (i % 5) * 20,
        ifOther: null,
        createdAt: now,
      });
    }

    // Monthly other expense
    const otherCol = db.collection('monthlyotherexpense');
    const existingOther = await otherCol.findOne({ userId });
    if (!existingOther) {
      await otherCol.insertOne({
        userId,
        typeId: otherExpenseTypeId,
        amount: 50 + (i % 3) * 25,
        ifOther: null,
        createdAt: now,
      });
    }

    // Assets
    const assetsCol = db.collection('assets');
    const existingAsset = await assetsCol.findOne({ userId });
    if (!existingAsset) {
      await assetsCol.insertOne({
        userId,
        assetsTypeId,
        description: `Savings account ${i + 1}`,
        marketValue: 5000 + (i % 15) * 500,
        nonMaritalTypeId: null,
        judgeAward: false,
        createdAt: now,
      });
      if (i % 2 === 0) {
        await assetsCol.insertOne({
          userId,
          assetsTypeId: 2, // Cash in banks
          description: `Checking ${i + 1}`,
          marketValue: 1000 + (i % 10) * 200,
          judgeAward: false,
          createdAt: now,
        });
      }
    }

    // Liabilities
    const liabCol = db.collection('liabilities');
    const existingLiab = await liabCol.findOne({ userId });
    if (!existingLiab) {
      await liabCol.insertOne({
        userId,
        liabilitiesTypeId,
        description: `Credit card ${i + 1}`,
        amountOwed: 500 + (i % 8) * 200,
        nonMaritalTypeId: null,
        userOwes: true,
        createdAt: now,
      });
    }
  }
  console.log('[seed-stress] Affidavit data (employment, income, expenses, assets, liabilities) for all petitioners.');
  console.log('[seed-stress] Done. All passwords:', STRESS_PASSWORD);
}

main()
  .catch((err) => {
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
