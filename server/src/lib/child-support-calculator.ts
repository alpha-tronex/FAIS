import { getFloridaGuidelineChart } from './florida-child-support-chart.js';

export type ChildSupportComputationInput = {
  numberOfChildren: number;
  parentANetMonthlyIncome: number;
  parentBNetMonthlyIncome: number;
  overnightsParentA?: number;
  overnightsParentB?: number;
  daycareMonthly?: number;
  healthInsuranceMonthly?: number;
  otherChildCareMonthly?: number;
};

export type ChildSupportComputationResult = {
  line1ParentA: number;
  line1ParentB: number;
  line1Total: number;
  line2BasicMonthlyObligation: number;
  line3PercentA: number;
  line3PercentB: number;
  line4ShareA: number;
  line4ShareB: number;
  line5TotalAdditional: number;
  line6AdditionalA: number;
  line6AdditionalB: number;
  line9MinimumObligationA: number;
  line9MinimumObligationB: number;
  substantialTimeSharingApplied: boolean;
  line10IncreasedBasicMonthlyObligation: number;
  line11IncreasedA: number;
  line11IncreasedB: number;
  line12PctOvernightsA: number;
  line12PctOvernightsB: number;
  line13SupportAByOtherPct: number;
  line13SupportBByOtherPct: number;
  line19OwedPetitionerToRespondent: number;
  line20OwedRespondentToPetitioner: number;
  line21PresumptivePaidBy: 'petitioner' | 'respondent' | 'none';
  line21PresumptiveAmount: number;
};

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampChildren(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(6, Math.round(n)));
}

async function lookupBasicMonthlyObligation(combinedNetIncome: number, numberOfChildren: number): Promise<number> {
  const chart = await getFloridaGuidelineChart();
  const col = clampChildren(numberOfChildren) - 1;
  if (!Number.isFinite(combinedNetIncome) || combinedNetIncome <= 0) return 0;
  const minIncome = chart[0].income;
  const maxIncome = chart[chart.length - 1].income;

  if (combinedNetIncome <= minIncome) {
    return Math.round((combinedNetIncome / minIncome) * chart[0].columns[col]);
  }
  if (combinedNetIncome >= maxIncome) {
    const prev = chart[chart.length - 2];
    const top = chart[chart.length - 1];
    const slope = (top.columns[col] - prev.columns[col]) / (top.income - prev.income);
    return Math.round(top.columns[col] + slope * (combinedNetIncome - top.income));
  }

  for (let i = 0; i < chart.length - 1; i += 1) {
    const a = chart[i];
    const b = chart[i + 1];
    if (combinedNetIncome === a.income) return a.columns[col];
    if (combinedNetIncome > a.income && combinedNetIncome < b.income) {
      const t = (combinedNetIncome - a.income) / (b.income - a.income);
      return Math.round(a.columns[col] + t * (b.columns[col] - a.columns[col]));
    }
  }
  return chart[chart.length - 1].columns[col];
}

export async function computeChildSupport(input: ChildSupportComputationInput): Promise<ChildSupportComputationResult> {
  const line1ParentA = Math.max(0, Number(input.parentANetMonthlyIncome) || 0);
  const line1ParentB = Math.max(0, Number(input.parentBNetMonthlyIncome) || 0);
  const line1Total = money(line1ParentA + line1ParentB);
  const line2BasicMonthlyObligation = await lookupBasicMonthlyObligation(line1Total, input.numberOfChildren);
  const line3PercentA = line1Total > 0 ? line1ParentA / line1Total : 0;
  const line3PercentB = line1Total > 0 ? line1ParentB / line1Total : 0;
  const line4ShareA = money(line2BasicMonthlyObligation * line3PercentA);
  const line4ShareB = money(line2BasicMonthlyObligation * line3PercentB);
  const line5TotalAdditional = money(
    (Number(input.daycareMonthly) || 0) +
      (Number(input.healthInsuranceMonthly) || 0) +
      (Number(input.otherChildCareMonthly) || 0)
  );
  const line6AdditionalA = money(line5TotalAdditional * line3PercentA);
  const line6AdditionalB = money(line5TotalAdditional * line3PercentB);
  const line9MinimumObligationA = money(line4ShareA + line6AdditionalA);
  const line9MinimumObligationB = money(line4ShareB + line6AdditionalB);

  const overnightsA = Math.max(0, Math.min(365, Math.round(Number(input.overnightsParentA) || 0)));
  const overnightsB = Math.max(0, Math.min(365, Math.round(Number(input.overnightsParentB) || 0)));
  const substantialTimeSharingApplied = overnightsA >= 73 && overnightsB >= 73;

  let line10IncreasedBasicMonthlyObligation = 0;
  let line11IncreasedA = 0;
  let line11IncreasedB = 0;
  let line12PctOvernightsA = 0;
  let line12PctOvernightsB = 0;
  let line13SupportAByOtherPct = 0;
  let line13SupportBByOtherPct = 0;
  let line19OwedPetitionerToRespondent = line9MinimumObligationA;
  let line20OwedRespondentToPetitioner = line9MinimumObligationB;

  if (substantialTimeSharingApplied) {
    line10IncreasedBasicMonthlyObligation = money(line2BasicMonthlyObligation * 1.5);
    line11IncreasedA = money(line10IncreasedBasicMonthlyObligation * line3PercentA);
    line11IncreasedB = money(line10IncreasedBasicMonthlyObligation * line3PercentB);
    line12PctOvernightsA = money((overnightsA / 365) * 100);
    line12PctOvernightsB = money((overnightsB / 365) * 100);
    line13SupportAByOtherPct = money(line11IncreasedA * (line12PctOvernightsB / 100));
    line13SupportBByOtherPct = money(line11IncreasedB * (line12PctOvernightsA / 100));
    line19OwedPetitionerToRespondent = line13SupportAByOtherPct;
    line20OwedRespondentToPetitioner = line13SupportBByOtherPct;
  }

  let line21PresumptivePaidBy: 'petitioner' | 'respondent' | 'none' = 'none';
  let line21PresumptiveAmount = 0;
  if (line19OwedPetitionerToRespondent > line20OwedRespondentToPetitioner) {
    line21PresumptivePaidBy = 'petitioner';
    line21PresumptiveAmount = money(line19OwedPetitionerToRespondent - line20OwedRespondentToPetitioner);
  } else if (line20OwedRespondentToPetitioner > line19OwedPetitionerToRespondent) {
    line21PresumptivePaidBy = 'respondent';
    line21PresumptiveAmount = money(line20OwedRespondentToPetitioner - line19OwedPetitionerToRespondent);
  }

  return {
    line1ParentA: money(line1ParentA),
    line1ParentB: money(line1ParentB),
    line1Total,
    line2BasicMonthlyObligation: money(line2BasicMonthlyObligation),
    line3PercentA,
    line3PercentB,
    line4ShareA,
    line4ShareB,
    line5TotalAdditional,
    line6AdditionalA,
    line6AdditionalB,
    line9MinimumObligationA,
    line9MinimumObligationB,
    substantialTimeSharingApplied,
    line10IncreasedBasicMonthlyObligation,
    line11IncreasedA,
    line11IncreasedB,
    line12PctOvernightsA,
    line12PctOvernightsB,
    line13SupportAByOtherPct,
    line13SupportBByOtherPct,
    line19OwedPetitionerToRespondent,
    line20OwedRespondentToPetitioner,
    line21PresumptivePaidBy,
    line21PresumptiveAmount
  };
}
