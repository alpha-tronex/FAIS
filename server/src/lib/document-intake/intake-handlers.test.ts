import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntakeDocument, classifyFromFilename } from './classify.js';
import { extractW2FromText } from './handlers/w2.js';
import { extractMortgageFromText } from './handlers/mortgage.js';
import { extractUtilityElectricFromText } from './handlers/utility-electric.js';
import { extractCreditCardMastercardFromText } from './handlers/credit-card.js';
import { assessTextQuality } from './text-quality.js';

describe('classifyIntakeDocument', () => {
  it('classifies W-2 from phrases', () => {
    assert.equal(classifyIntakeDocument('Form W-2 Wage and Tax Statement\nBox 1', 'doc.pdf'), 'w2');
  });

  it('classifies mortgage from text', () => {
    assert.equal(
      classifyIntakeDocument('Your mortgage statement\nUnpaid principal balance $100,000.00', 'stmt.pdf'),
      'mortgage_statement'
    );
  });

  it('classifies electric utility', () => {
    assert.equal(
      classifyIntakeDocument('Electric service for 450 kWh\nAmount due $123.45', 'bill.pdf'),
      'utility_electric'
    );
  });

  it('classifies credit card from new balance', () => {
    assert.equal(
      classifyIntakeDocument('Mastercard\nNew Balance $500.00\nMinimum Payment $25.00', 'cc.pdf'),
      'credit_card_mastercard'
    );
  });

  it('falls back to filename', () => {
    assert.equal(classifyIntakeDocument('', '747179328-W2-1.pdf'), 'w2');
    assert.equal(classifyFromFilename('wells-fargo-mortgage.pdf'), 'mortgage_statement');
  });
});

describe('assessTextQuality', () => {
  it('marks empty as weak', () => {
    assert.equal(assessTextQuality('').weak, true);
  });

  it('marks long alphanumeric text as not weak', () => {
    const t = 'Employer ABC Corp '.repeat(30) + 'Wages tips 12345.67';
    const q = assessTextQuality(t);
    assert.equal(q.weak, false);
    assert.ok(q.charCount > 120);
  });
});

describe('handlers v0', () => {
  it('extractW2FromText picks box-like wages', () => {
    const { payload, fieldConfidences } = extractW2FromText(`
      Form W-2 Wage and Tax Statement
      Employer's name, address, and ZIP code
      ACME CORP
      1 45000.00 2 45000.00
    `);
    assert.equal(payload.targetWorkflow, 'employment');
    assert.equal(payload.box1WagesTipsOther, 45000);
    assert.ok((fieldConfidences.box1WagesTipsOther ?? 0) > 0);
  });

  it('extractW2FromText captures employer on next line', () => {
    const { payload } = extractW2FromText(`
      Form W-2 Wage and Tax Statement
      C Employer's name, address, and ZIP code
      COGNIZANT TECHNOLOGY SOLUTIONS US CORPORATION
      1 82786.06
    `);
    assert.equal(payload.employerName, 'COGNIZANT TECHNOLOGY SOLUTIONS US CORPORATION');
  });

  it('extractW2FromText captures employer on same heading line', () => {
    const { payload } = extractW2FromText(`
      Form W-2 Wage and Tax Statement
      Employer's name, address, and ZIP code: ACME PAYROLL SERVICES INC
      wages, tips, other compensation 45000.00
    `);
    assert.equal(payload.employerName, 'ACME PAYROLL SERVICES INC');
  });

  it('extractW2FromText skips box d after employer heading and unpacks glued box-1 amounts', () => {
    const { payload } = extractW2FromText(`
      Form W-2 Wage and Tax Statement
      c Employer's name, address, and ZIP code
      d Control number
      e Employee's first name
      71-0794409
      WAL-MART ASSOCIATES, INC.
      BENTONVILLE, AR 72716
      1   Wages, tips, other compensation2   Federal income tax withheld
      ---------------------------------------------------------------------
      71389.966063.93
    `);
    assert.equal(payload.employerName, 'WAL-MART ASSOCIATES, INC.');
    assert.equal(payload.box1WagesTipsOther, 71389.96);
  });

  it('extractW2FromText decodes PUA tax-year digits and unpacks concatenated wages', () => {
    const pua2019 = '\uF032\uF030\uF031\uF039';
    const { payload } = extractW2FromText(`
      Form W-2    Wage and Tax Statement
      Employer’s name, address, and ZIP code
      ${pua2019}
      Wages, tips, other comp.
      323133247
      391592000
      6480.83410.18
      Parallel Employment Group Inc.
    `);
    assert.equal(payload.taxYear, '2019');
    assert.equal(payload.employerName, 'Parallel Employment Group Inc.');
    assert.equal(payload.box1WagesTipsOther, 6480.83);
  });

  it('extractMortgageFromText finds principal balance', () => {
    const { payload } = extractMortgageFromText(
      'Mortgage statement\nUnpaid principal balance $250,000.00\nMonthly payment $1,800.00'
    );
    assert.equal(payload.targetWorkflow, 'liabilities');
    assert.equal(payload.principalBalance, 250000);
    assert.equal(payload.monthlyPayment, 1800);
  });

  it('extractMortgageFromText captures lender and labeled dates', () => {
    const { payload } = extractMortgageFromText(
      [
        'Rocket Mortgage, LLC',
        'Loan Number: 3450355498',
        'Statement Date: 08/16/2024',
        'Due Date: 09/01/2024',
        'Principal Balance: $235,941.32',
        'Monthly Payment: $2,577.73',
      ].join('\n')
    );
    assert.equal(payload.lenderName, 'Rocket Mortgage, LLC');
    assert.equal(payload.loanNumber, '3450355498');
    assert.equal(payload.statementDate, '08/16/2024');
    assert.equal(payload.dueDate, '09/01/2024');
    assert.equal(payload.principalBalance, 235941.32);
    assert.equal(payload.monthlyPayment, 2577.73);
  });

  it('extractMortgageFromText captures wells-fargo style payment due', () => {
    const { payload } = extractMortgageFromText(
      [
        'WELLS FARGO HOME MORTGAGE',
        'Statement date 07/16/17',
        'Loan number 0345759146',
        'Total payment due 08/01/17 $1,049.96',
        'Unpaid principal balance $105,658.45',
      ].join('\n')
    );
    assert.equal(payload.lenderName, 'WELLS FARGO HOME MORTGAGE');
    assert.equal(payload.loanNumber, '0345759146');
    assert.equal(payload.statementDate, '07/16/17');
    assert.equal(payload.monthlyPayment, 1049.96);
    assert.equal(payload.principalBalance, 105658.45);
  });

  it('extractMortgageFromText handles Caliber-style labels', () => {
    const text = [
      'CALIBER HOME LOANS, INC.',
      'Total Lender Advance Balance$0.00',
      'Maturity Date',
      'Payment Due Date',
      '06/01/21',
      'Account Number9799826475',
      'Outstanding Principal',
      '$413,000.00',
      'StatementDate:05/01/2021',
      'Regular Monthly Payment',
      'Past Due Amount$0.00',
      'AmountDue$1,690.00',
      'AmountDueby06/01/21 $1,690.00',
    ].join('\n');

    const { payload } = extractMortgageFromText(text);
    assert.equal(payload.lenderName, 'CALIBER HOME LOANS, INC.');
    assert.equal(payload.principalBalance, 413000);
    assert.equal(payload.monthlyPayment, 1690);
    assert.equal(payload.statementDate, '05/01/2021');
    assert.equal(payload.dueDate, '06/01/21');
    assert.equal(payload.loanNumber, '9799826475');
  });

  it('extractMortgageFromText handles Homepoint-style layout (multi-line due date + account)', () => {
    const text = [
      'homepoint',
      'MORTGAGE STATEMENT',
      'Statement Date: 08/01/2022',
      '53 BANK',
      '1-111-TJNUM_1234567-111-2-333--444-555-666',
      'Account Number:',
      'Payment Due Date:',
      '',
      'Amount Due:',
      '1000000001',
      '9/1/2012',
      '$1,043.00',
      'Outstanding Principal Balance',
      '$507,855.00',
      'HOME POINT FINANCIAL CORPORATION',
    ].join('\n');

    const { payload } = extractMortgageFromText(text);
    assert.equal(payload.lenderName, 'HOME POINT FINANCIAL CORPORATION');
    assert.equal(payload.principalBalance, 507855);
    assert.equal(payload.monthlyPayment, 1043);
    assert.equal(payload.statementDate, '08/01/2022');
    assert.equal(payload.dueDate, '9/1/2022');
    assert.equal(payload.loanNumber, '1000000001');
  });

  it('extractMortgageFromText finds Federal Credit Union servicer name', () => {
    const text = [
      'Mortgage Statement',
      'Loan Number:',
      '250000',
      'Member Number:',
      '31234567891',
      'Payment Due Date:',
      '02/01/2014',
      'Amount Due:',
      '$744.53',
      'Outstanding Principal:',
      '$125,835.84',
      'Statement Date:',
      '01/31/2014',
      'L&N Federal Credit Union',
      '9203 Smyrna Parkway',
      'Louisville, KY40229-1415',
    ].join('\n');

    const { payload } = extractMortgageFromText(text);
    assert.equal(payload.lenderName, 'L&N Federal Credit Union');
    assert.equal(payload.loanNumber, '250000');
    assert.equal(payload.principalBalance, 125835.84);
    assert.equal(payload.monthlyPayment, 744.53);
    assert.equal(payload.statementDate, '01/31/2014');
    assert.equal(payload.dueDate, '02/01/2014');
  });

  it('extractMortgageFromText falls back to TJNUM line when account is placeholder', () => {
    const tj = '1-111-TJNUM_1234567-111-2-333--444-555-666';
    const text = [
      'homepoint',
      'Statement Date: 08/01/2022',
      '53 BANK',
      tj,
      'Account Number:',
      'Payment Due Date:',
      'Amount Due:',
      '9999999999',
      '9/1/2012',
      '$1,043.00',
      'Outstanding Principal Balance',
      '$507,855.00',
    ].join('\n');

    const { payload } = extractMortgageFromText(text);
    assert.equal(payload.loanNumber, tj);
    assert.equal(payload.principalBalance, 507855);
  });

  it('extractUtilityElectricFromText finds amount due', () => {
    const { payload } = extractUtilityElectricFromText(
      'Electric company\nTotal amount due $88.42\nkWh this period 400'
    );
    assert.equal(payload.targetWorkflow, 'monthlyHouseholdExpense');
    assert.equal(payload.amountDue, 88.42);
  });

  it('extractUtilityElectricFromText captures comed amount and service range', () => {
    const { payload } = extractUtilityElectricFromText(
      [
        'ComEd',
        'Issued 12/29/21 Account # 0193064158',
        'SERVICE FROM 11/24/21 THROUGH 12/29/21 (35 DAYS)',
        'Total Amount Due $141.43',
      ].join('\n')
    );
    assert.equal(payload.utilityName, 'ComEd');
    assert.equal(payload.accountNumber, '0193064158');
    assert.equal(payload.amountDue, 141.43);
    assert.equal(payload.billingPeriodLabel, '11/24/21 THROUGH 12/29/21 (35 DAYS)');
  });

  it('extractUtilityElectricFromText avoids payment-history false positives', () => {
    const { payload } = extractUtilityElectricFromText(
      [
        'Payment Deducted on 1/20/22 $141.43',
        'Thank you for your payments totaling $94.25.',
        'Total Amount Due $88.42',
      ].join('\n')
    );
    assert.equal(payload.amountDue, 88.42);
  });

  it('extractUtilityElectricFromText adds review note on conflicting due values', () => {
    const { payload, fieldConfidences } = extractUtilityElectricFromText(
      [
        'Total Amount Due $141.43',
        'Amount Due $88.42',
      ].join('\n')
    );
    assert.equal(payload.amountDue, 141.43);
    assert.ok((payload.reviewNotes as string[] | undefined)?.length);
    assert.ok((fieldConfidences.amountDue ?? 0) < 0.7);
  });

  it('extractUtilityElectricFromText handles multiline pay-this and Think Energy vendor', () => {
    const { payload } = extractUtilityElectricFromText(
      [
        'Think Energy',
        'ENGIE Retail',
        'BILLING PERIOD',
        'Sep 23 - Oct 25, 2021',
        'AMOUNT DUE:',
        'DUE DATE:',
        'Pay This',
        'Amount',
        '$7.55',
        'Total Amount Due',
        'Amount due if paid after November 11, 2021',
        '$7.93',
        'Total Current Charges',
        '$7.55',
        'Think Energy Account Number',
        '5610244109901',
      ].join('\n')
    );
    assert.equal(payload.utilityName, 'Think Energy');
    assert.equal(payload.amountDue, 7.55);
    assert.equal(payload.accountNumber, '5610244109901');
    assert.ok(String(payload.billingPeriodLabel ?? '').includes('Sep 23'));
  });

  it('extractCreditCardMastercardFromText finds new balance', () => {
    const { payload } = extractCreditCardMastercardFromText(
      'Bank of Example\nNew Balance $1,234.56\nMinimum Payment Due $35.00'
    );
    assert.equal(payload.targetWorkflow, 'liabilities');
    assert.equal(payload.statementBalance, 1234.56);
    assert.equal(payload.minimumPayment, 35);
  });

  it('extractCreditCardMastercardFromText captures due date and last4', () => {
    const { payload } = extractCreditCardMastercardFromText(
      [
        'Dec. 10 - Jan. 09, 2016',
        'Account ending in 7775',
        'NEW BALANCE MINIMUM PAYMENT DUE DATE',
        '$1,032.77 $87.00 Feb 06, 2016',
        'Capital One Bank (USA), N.A.',
      ].join('\n')
    );
    assert.equal(payload.creditorName, 'Capital One');
    assert.equal(payload.accountLast4, '7775');
    assert.equal(payload.statementBalance, 1032.77);
    assert.equal(payload.minimumPayment, 87);
    assert.equal(payload.dueDate, 'Feb 06, 2016');
    assert.equal(payload.statementClosingDate, 'Jan. 09, 2016');
  });

  it('extractCreditCardMastercardFromText ignores warning-example minimums', () => {
    const { payload } = extractCreditCardMastercardFromText(
      [
        'MINIMUM PAYMENT WARNING: If you make only the minimum payment each period...',
        'Minimum Payment 9 Years $1,878',
        'NEW BALANCE MINIMUM PAYMENT DUE DATE',
        '$1,032.77 $87.00 Feb 06, 2016',
      ].join('\n')
    );
    assert.equal(payload.minimumPayment, 87);
    assert.equal(payload.statementBalance, 1032.77);
  });

  it('extractCreditCardMastercardFromText adds review note on conflicting minimums', () => {
    const { payload, fieldConfidences } = extractCreditCardMastercardFromText(
      [
        'Minimum Payment Due $35.00',
        'Minimum Payment Due $87.00',
        'New Balance $1,032.77',
      ].join('\n')
    );
    assert.ok((payload.reviewNotes as string[] | undefined)?.length);
    assert.ok((fieldConfidences.minimumPayment ?? 0) < 0.55);
  });

  it('extractCreditCardMastercardFromText handles spaced-thousands balance and masked last4', () => {
    const { payload } = extractCreditCardMastercardFromText(
      [
        'Account statement of the debit card MasterCard Mass',
        'Available on 14.06.2020',
        '84 072.12',
        'CARD NUMBER',
        '•••• 9053',
        'Card operation: 5101 26** **** 9053, in the amount of: 1 715.00 RUR',
      ].join('\n')
    );
    assert.equal(payload.statementBalance, 84072.12);
    assert.equal(payload.accountLast4, '9053');
  });

  it('extractCreditCardMastercardFromText captures Citi current balance + payment due date', () => {
    const { payload } = extractCreditCardMastercardFromText(
      [
        'Citibank Singapore Ltd',
        'Statement Date: October 19, 2018',
        'Payment Due Date: November 13, 2018',
        'Current Balance$114.79',
        'Total Minimum Payment$50.00',
        '4147465002040807               114.79                50.00',
      ].join('\n')
    );
    assert.equal(payload.creditorName, 'Citibank');
    assert.equal(payload.statementBalance, 114.79);
    assert.equal(payload.minimumPayment, 50);
    assert.equal(payload.dueDate, 'November 13, 2018');
    assert.equal(payload.accountLast4, '0807');
  });
});
