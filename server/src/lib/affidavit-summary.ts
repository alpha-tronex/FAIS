import mongoose from 'mongoose';
import { asFiniteNumber } from './number.js';
import { payFrequencyToAnnualMultiplier } from './affidavit-pdf.js';
import {
  userScopedFilter,
  listAffidavitRows,
  listEmploymentRowsForUser
} from './affidavit-store.js';

export type AffidavitSummary = {
  grossAnnualIncome: number;
  grossAnnualIncomeFromEmployment: number;
  grossMonthlyIncomeFromMonthlyIncome: number;
  grossAnnualIncomeFromMonthlyIncome: number;
  threshold: number;
  form: 'short' | 'long';
  monthlyIncomeBreakdown: { typeId: number | null; typeName: string; amount: number; ifOther: string | null }[];
};

export async function computeAffidavitSummary(userObjectId: string): Promise<AffidavitSummary> {
  const employmentRows = await listEmploymentRowsForUser(userObjectId);
  const employmentAnnual = employmentRows.reduce((sum: number, row: { payRate?: unknown; payFrequencyTypeId?: unknown }) => {
    const payRate = Number(row?.payRate);
    const freqId = asFiniteNumber(row?.payFrequencyTypeId);
    if (!Number.isFinite(payRate) || payRate <= 0) return sum;
    const mult = payFrequencyToAnnualMultiplier(freqId);
    if (mult == null) return sum;
    return sum + payRate * mult;
  }, 0);

  const monthlyIncomeRows = await listAffidavitRows('monthlyincome', userScopedFilter(userObjectId));
  const grossMonthlyIncome = monthlyIncomeRows.reduce((sum: number, r: { amount?: unknown }) => sum + Number(r?.amount ?? 0), 0);
  const grossAnnualIncomeFromMonthlyIncome = grossMonthlyIncome * 12;

  const incomeTypeRows = await mongoose.connection
    .collection('lookup_monthly_income_types')
    .find({})
    .project({ id: 1, name: 1 })
    .toArray();
  const typeNameById = new Map<number, string>();
  for (const row of incomeTypeRows as { id?: unknown; name?: string }[]) {
    const id = asFiniteNumber(row?.id);
    if (id != null && id > 0) typeNameById.set(id, String(row?.name ?? '').trim());
  }
  const monthlyIncomeBreakdown = monthlyIncomeRows.map((r: { typeId?: unknown; amount?: unknown; ifOther?: string | null }) => {
    const typeId = asFiniteNumber(r?.typeId) ?? null;
    return {
      typeId,
      typeName: (typeId != null ? typeNameById.get(typeId) : null) ?? `Type ${typeId ?? '?'}`,
      amount: Number(r?.amount ?? 0),
      ifOther: r?.ifOther ?? null
    };
  });

  const grossAnnualIncome = employmentAnnual;
  const threshold = 50000;
  const form: 'short' | 'long' = grossAnnualIncome < threshold ? 'short' : 'long';

  return {
    grossAnnualIncome,
    grossAnnualIncomeFromEmployment: employmentAnnual,
    grossMonthlyIncomeFromMonthlyIncome: grossMonthlyIncome,
    grossAnnualIncomeFromMonthlyIncome,
    threshold,
    form,
    monthlyIncomeBreakdown
  };
}
