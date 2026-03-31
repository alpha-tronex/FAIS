import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import test from 'node:test';
import {
  buildAffidavitInsertPlan,
  getIntakeApplyBlockReason,
  mergeIdentityFromExtraction,
  normalizeMatchKey,
  parseIntakeConflictPolicy,
  pickNewestMergeCandidate,
  rowMergeKeyForIntake
} from './apply-intake.js';

const uid = () => new mongoose.Types.ObjectId();

test('getIntakeApplyBlockReason blocks weak text', () => {
  const msg = getIntakeApplyBlockReason({
    status: 'pending_review',
    documentType: 'w2',
    rawPayload: { employerName: 'Acme', box1WagesTipsOther: 1000, classifiedType: 'w2' },
    textQuality: { weak: true }
  });
  assert.ok(msg?.includes('weak'));
});

test('getIntakeApplyBlockReason blocks ocrNote', () => {
  const msg = getIntakeApplyBlockReason({
    status: 'pending_review',
    documentType: 'w2',
    rawPayload: { employerName: 'Acme', box1WagesTipsOther: 1000, ocrNote: 'scan' },
    textQuality: { weak: false }
  });
  assert.ok(msg?.includes('low-quality'));
});

test('getIntakeApplyBlockReason blocks missing required fields', () => {
  const msg = getIntakeApplyBlockReason({
    status: 'pending_review',
    documentType: 'w2',
    rawPayload: { employerName: 'Acme', classifiedType: 'w2' },
    textQuality: null
  });
  assert.ok(msg?.includes('required'));
});

test('getIntakeApplyBlockReason allows clean w2', () => {
  assert.equal(
    getIntakeApplyBlockReason({
      status: 'pending_review',
      documentType: 'w2',
      rawPayload: { employerName: 'Acme', box1WagesTipsOther: 50000, classifiedType: 'w2', taxYear: '2023' },
      textQuality: { weak: false }
    }),
    null
  );
});

test('buildAffidavitInsertPlan w2 uses annual pay frequency', () => {
  const sub = uid();
  const plan = buildAffidavitInsertPlan(
    {
      documentType: 'w2',
      rawPayload: {
        employerName: 'Acme Corp',
        box1WagesTipsOther: 75000,
        taxYear: '2023',
        classifiedType: 'w2'
      }
    } as any,
    sub
  );
  assert.equal(plan?.collection, 'employment');
  assert.equal(plan?.document['payFrequencyTypeId'], 5);
  assert.equal(plan?.document['payRate'], 75000);
  assert.equal(plan?.document['name'], 'Acme Corp');
});

test('buildAffidavitInsertPlan utility uses household expense type 5', () => {
  const sub = uid();
  const plan = buildAffidavitInsertPlan(
    {
      documentType: 'utility_electric',
      rawPayload: {
        utilityName: 'ComEd',
        amountDue: 88.42,
        classifiedType: 'utility_electric'
      }
    } as any,
    sub
  );
  assert.equal(plan?.collection, 'monthlyhouseholdexpense');
  assert.equal(plan?.document['typeId'], 5);
  assert.equal(plan?.document['amount'], 88.42);
  assert.equal(plan?.document['ifOther'], 'ComEd');
});

test('buildAffidavitInsertPlan credit card uses liabilities type 4', () => {
  const sub = uid();
  const plan = buildAffidavitInsertPlan(
    {
      documentType: 'credit_card_mastercard',
      rawPayload: {
        creditorName: 'Chase',
        statementBalance: 1200.5,
        accountLast4: '4242',
        classifiedType: 'credit_card_mastercard'
      }
    } as any,
    sub
  );
  assert.equal(plan?.collection, 'liabilities');
  assert.equal(plan?.document['liabilitiesTypeId'], 4);
  assert.equal(plan?.document['amountOwed'], 1200.5);
});

test('parseIntakeConflictPolicy defaults to append', () => {
  assert.equal(parseIntakeConflictPolicy(undefined), 'append');
  assert.equal(parseIntakeConflictPolicy({}), 'append');
  assert.equal(parseIntakeConflictPolicy({ conflictPolicy: 'append' }), 'append');
});

test('parseIntakeConflictPolicy accepts merge_if_match', () => {
  assert.equal(parseIntakeConflictPolicy({ conflictPolicy: 'merge_if_match' }), 'merge_if_match');
});

test('normalizeMatchKey lowercases and collapses spaces', () => {
  assert.equal(normalizeMatchKey('  Acme  Corp  '), 'acme corp');
});

test('mergeIdentityFromExtraction utility and row key align', () => {
  const ext = {
    documentType: 'utility_electric' as const,
    rawPayload: { utilityName: 'ComEd', amountDue: 10, classifiedType: 'utility_electric' }
  };
  const id = mergeIdentityFromExtraction(ext as any);
  assert.equal(id?.collection, 'monthlyhouseholdexpense');
  assert.equal(id?.expenseTypeId, 5);
  assert.equal(id?.key, 'comed');
  const rowKey = rowMergeKeyForIntake('monthlyhouseholdexpense', { typeId: 5, ifOther: 'comed' });
  assert.equal(rowKey, id?.key);
});

test('pickNewestMergeCandidate prefers larger ObjectId', () => {
  const oid1 = new mongoose.Types.ObjectId('000000000000000000000001');
  const oid2 = new mongoose.Types.ObjectId('ffffffffffffffffffffffff');
  const id = mergeIdentityFromExtraction({
    documentType: 'w2',
    rawPayload: { employerName: 'Acme', box1: 1, classifiedType: 'w2' }
  } as any)!;
  const rows = [
    { _id: oid1, name: 'Acme' },
    { _id: oid2, name: 'ACME' }
  ] as Record<string, unknown>[];
  const pick = pickNewestMergeCandidate('employment', rows, id);
  assert.equal(String(pick?._id), String(oid2));
});
