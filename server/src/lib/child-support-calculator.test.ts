import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeChildSupport } from './child-support-calculator.js';

describe('computeChildSupport', () => {
  it('matches chart anchor for 1 child at combined 2000', async () => {
    const res = await computeChildSupport({
      numberOfChildren: 1,
      parentANetMonthlyIncome: 1000,
      parentBNetMonthlyIncome: 1000
    });
    assert.equal(res.line2BasicMonthlyObligation, 442);
    assert.equal(res.line4ShareA, 221);
    assert.equal(res.line4ShareB, 221);
    assert.equal(res.line21PresumptivePaidBy, 'none');
    assert.equal(res.line21PresumptiveAmount, 0);
  });

  it('computes substantial time-sharing gross-up path', async () => {
    const res = await computeChildSupport({
      numberOfChildren: 2,
      parentANetMonthlyIncome: 3000,
      parentBNetMonthlyIncome: 2000,
      overnightsParentA: 182,
      overnightsParentB: 183,
      daycareMonthly: 500,
      healthInsuranceMonthly: 200
    });
    assert.equal(res.substantialTimeSharingApplied, true);
    assert.ok(res.line10IncreasedBasicMonthlyObligation > res.line2BasicMonthlyObligation);
    assert.ok(res.line21PresumptiveAmount >= 0);
  });

  it('extrapolates above chart max income', async () => {
    const res = await computeChildSupport({
      numberOfChildren: 1,
      parentANetMonthlyIncome: 9000,
      parentBNetMonthlyIncome: 3000
    });
    assert.ok(res.line2BasicMonthlyObligation > 1437);
  });
});
