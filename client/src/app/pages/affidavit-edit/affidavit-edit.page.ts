import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, forkJoin, from, map, of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AffidavitDataService, AssetRow, EmploymentRow, LiabilityRow, MonthlyLineRow } from '../../services/affidavit-data.service';
import { LookupsService, LookupItem } from '../../services/lookups.service';
import { AssetCreatePayload } from './sections/affidavit-assets-section.component';
import { EmploymentCreatePayload } from './sections/affidavit-employment-section.component';
import { LiabilityCreatePayload } from './sections/affidavit-liabilities-section.component';
import { MonthlyLineCreatePayload, MonthlyLineUpdatePayload } from './sections/affidavit-monthly-lines-section.component';

@Component({
  standalone: false,
  selector: 'app-affidavit-edit-page',
  templateUrl: './affidavit-edit.page.html',
  styleUrl: './affidavit-edit.page.css'
})
export class AffidavitEditPage implements OnInit, OnChanges, OnDestroy {
  @Input() userId: string | null = null;
  @Input() caseId: string | null = null;
  @Input() hideNav = false;

  steps = [
    { key: 'employment', title: 'Employment' },
    { key: 'monthlyIncome', title: 'Monthly income' },
    { key: 'monthlyDeductions', title: 'Monthly deductions' },
    { key: 'monthlyHouseholdExpenses', title: 'Monthly household expenses' },
    { key: 'assets', title: 'Assets' },
    { key: 'liabilities', title: 'Liabilities' }
  ] as const;

  currentStepIndex = 0;
  currentStepKey: (typeof this.steps)[number]['key'] = 'employment';
  currentNoneSelected = false;

  private readonly noneStoragePrefix = 'fais.affidavitWizard.none';
  noneSelected: Record<(typeof this.steps)[number]['key'], boolean> = {
    employment: false,
    monthlyIncome: false,
    monthlyDeductions: false,
    monthlyHouseholdExpenses: false,
    assets: false,
    liabilities: false
  };

  // Lookups
  payFrequencies: LookupItem[] = [];
  incomeTypes: LookupItem[] = [];
  deductionTypes: LookupItem[] = [];
  householdExpenseTypes: LookupItem[] = [];
  assetsTypes: LookupItem[] = [];
  liabilitiesTypes: LookupItem[] = [];
  nonMaritalTypes: LookupItem[] = [];

  // Data
  employment: EmploymentRow[] = [];
  monthlyIncome: MonthlyLineRow[] = [];
  monthlyDeductions: MonthlyLineRow[] = [];
  monthlyHouseholdExpenses: MonthlyLineRow[] = [];
  assets: AssetRow[] = [];
  liabilities: LiabilityRow[] = [];

  busy = false;
  error: string | null = null;

  /** When set, confirm popup is open; on confirm we remove this id for current step type. */
  showRemoveConfirm = false;
  pendingRemoveId: string | null = null;

  /** When set, user clicked Next on Monthly income but employment vs type-1 salary mismatch. */
  showMonthlyIncomeMismatchConfirm = false;
  monthlyIncomeMismatchMessage = '';

  /** When set, user checked "I have nothing to report" but step has data; confirm before clearing. */
  showNoneConfirm = false;
  pendingNoneStepKey: (typeof this.steps)[number]['key'] | null = null;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly api: AffidavitDataService,
    private readonly lookups: LookupsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }

    const qpUserId = this.route.snapshot.queryParamMap.get('userId');
    if (qpUserId && !this.userId) {
      this.userId = qpUserId;
    }

    const qpCaseId = this.route.snapshot.queryParamMap.get('caseId');
    if (qpCaseId && !this.caseId) {
      this.caseId = qpCaseId;
    }

    if (this.userId && !this.auth.isAdmin()) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }

    this.syncCurrentStepKey();
    this.loadNoneSelections();

    this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userId'] && !changes['userId'].firstChange) {
      if (this.userId && !this.auth.isAdmin()) {
        void this.router.navigateByUrl('/my-cases');
        return;
      }

      this.syncCurrentStepKey();
      this.loadNoneSelections();
      this.refresh();
    }

    if (changes['caseId'] && !changes['caseId'].firstChange) {
      // View will update automatically with Zone.js
    }
  }

  private syncCurrentStepKey() {
    this.currentStepKey = this.steps[this.currentStepIndex]?.key ?? 'employment';
    this.currentNoneSelected = Boolean(this.noneSelected[this.currentStepKey]);
  }

  private storageKey(stepKey: (typeof this.steps)[number]['key']): string {
    // For admin-on-behalf we key by userId; for self we use a stable 'self'.
    const scope = this.userId || 'self';
    return `${this.noneStoragePrefix}.${scope}.${stepKey}`;
  }

  private loadNoneSelections() {
    for (const step of this.steps) {
      const raw = localStorage.getItem(this.storageKey(step.key));
      this.noneSelected[step.key] = raw === '1';
    }
    this.currentNoneSelected = Boolean(this.noneSelected[this.currentStepKey]);
  }

  setNoneForStep(stepKey: (typeof this.steps)[number]['key'], value: boolean) {
    this.noneSelected[stepKey] = value;
    localStorage.setItem(this.storageKey(stepKey), value ? '1' : '0');

    const shouldAdvance = value && !this.busy && stepKey === this.currentStepKey && this.canGoNext();

    // Keep the checkbox controlled for the current step.
    this.currentNoneSelected = Boolean(this.noneSelected[this.currentStepKey]);

    if (shouldAdvance) {
      // Defer step change so ngModel/DOM state doesn't "stick" across steps.
      setTimeout(() => {
        if (this.busy) return;
        if (!this.canGoNext()) return;
        if (this.currentStepKey !== stepKey) return;

        this.currentStepIndex += 1;
        this.syncCurrentStepKey();
      }, 0);
    }
  }

  /** True if the step has at least one row of data. */
  stepHasData(stepKey: (typeof this.steps)[number]['key']): boolean {
    switch (stepKey) {
      case 'employment':
        return this.employment.length > 0;
      case 'monthlyIncome':
        return this.monthlyIncome.length > 0;
      case 'monthlyDeductions':
        return this.monthlyDeductions.length > 0;
      case 'monthlyHouseholdExpenses':
        return this.monthlyHouseholdExpenses.length > 0;
      case 'assets':
        return this.assets.length > 0;
      case 'liabilities':
        return this.liabilities.length > 0;
      default:
        return false;
    }
  }

  /**
   * Called when the "I have nothing to report" checkbox changes.
   * If checking and step has data, show confirm; otherwise update state directly.
   */
  onNoneCheckboxChange(value: boolean): void {
    const stepKey = this.currentStepKey;
    if (!value) {
      this.setNoneForStep(stepKey, false);
      return;
    }
    if (!this.stepHasData(stepKey)) {
      this.setNoneForStep(stepKey, true);
      return;
    }
    this.pendingNoneStepKey = stepKey;
    this.showNoneConfirm = true;
  }

  noneConfirmTitle(): string {
    const key = this.pendingNoneStepKey ?? this.currentStepKey;
    const stepTitle = this.steps.find((s) => s.key === key)?.title ?? 'this section';
    return `Clear all ${stepTitle} data?`;
  }

  noneConfirmMessage(): string {
    const key = this.pendingNoneStepKey ?? this.currentStepKey;
    const stepTitle = this.steps.find((s) => s.key === key)?.title ?? 'this section';
    return `You have data in ${stepTitle}. Checking "I have nothing to report" will remove all of it. This cannot be undone.`;
  }

  onConfirmNoneReport(): void {
    const stepKey = this.pendingNoneStepKey;
    this.showNoneConfirm = false;
    this.pendingNoneStepKey = null;
    if (!stepKey) return;

    this.busy = true;
    this.error = null;
    this.subscription?.unsubscribe();

    const uid = this.userId || undefined;

    const deleteAll$ =
      stepKey === 'employment'
        ? this.employment.length === 0
          ? of(undefined)
          : forkJoin(this.employment.map((e) => from(this.api.deleteEmployment(e.id, uid)))).pipe(map(() => undefined))
        : stepKey === 'monthlyIncome'
          ? this.monthlyIncome.length === 0
            ? of(undefined)
            : forkJoin(this.monthlyIncome.map((r) => from(this.api.deleteMonthlyIncome(r.id, uid)))).pipe(map(() => undefined))
          : stepKey === 'monthlyDeductions'
            ? this.monthlyDeductions.length === 0
              ? of(undefined)
              : forkJoin(this.monthlyDeductions.map((r) => from(this.api.deleteMonthlyDeductions(r.id, uid)))).pipe(map(() => undefined))
            : stepKey === 'monthlyHouseholdExpenses'
              ? this.monthlyHouseholdExpenses.length === 0
                ? of(undefined)
                : forkJoin(this.monthlyHouseholdExpenses.map((r) => from(this.api.deleteMonthlyHouseholdExpenses(r.id, uid)))).pipe(
                    map(() => undefined)
                  )
              : stepKey === 'assets'
                ? this.assets.length === 0
                  ? of(undefined)
                  : forkJoin(this.assets.map((a) => from(this.api.deleteAsset(a.id, uid)))).pipe(map(() => undefined))
                : stepKey === 'liabilities'
                  ? this.liabilities.length === 0
                    ? of(undefined)
                    : forkJoin(this.liabilities.map((l) => from(this.api.deleteLiability(l.id, uid)))).pipe(map(() => undefined))
                  : of(undefined);

    this.subscription = deleteAll$
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => {
          this.setNoneForStep(stepKey, true);
          this.refresh();
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? `Failed to clear ${stepKey} data`;
        }
      });
  }

  onCancelNoneReport(): void {
    this.showNoneConfirm = false;
    this.pendingNoneStepKey = null;
  }

  noneLabel(stepKey: (typeof this.steps)[number]['key']): string {
    switch (stepKey) {
      case 'employment':
        return 'I have no employment to report';
      case 'liabilities':
        return 'I have no liabilities to report';
      case 'assets':
        return 'I have no assets to report';
      default:
        return 'Nothing to report for this section';
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private loadAll(userId?: string) {
    return forkJoin({
      payFrequencies: from(this.lookups.list('pay-frequency-types')),
      incomeTypes: from(this.lookups.list('monthly-income-types')),
      deductionTypes: from(this.lookups.list('monthly-deduction-types')),
      householdExpenseTypes: from(this.lookups.list('monthly-household-expense-types')),
      assetsTypes: from(this.lookups.list('assets-types')),
      liabilitiesTypes: from(this.lookups.list('liabilities-types')),
      nonMaritalTypes: from(this.lookups.list('non-marital-types')),

      employment: from(this.api.listEmployment(userId)),
      monthlyIncome: from(this.api.listMonthlyIncome(userId)),
      monthlyDeductions: from(this.api.listMonthlyDeductions(userId)),
      monthlyHouseholdExpenses: from(this.api.listMonthlyHouseholdExpenses(userId)),
      assets: from(this.api.listAssets(userId)),
      liabilities: from(this.api.listLiabilities(userId))
    });
  }

  refresh() {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;

    this.subscription = this.loadAll(this.userId || undefined)
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (r) => {
          this.payFrequencies = r.payFrequencies;
          this.incomeTypes = r.incomeTypes;
          this.deductionTypes = r.deductionTypes;
          this.householdExpenseTypes = r.householdExpenseTypes;
          this.assetsTypes = r.assetsTypes;
          this.liabilitiesTypes = r.liabilitiesTypes;
          this.nonMaritalTypes = r.nonMaritalTypes;

          this.employment = r.employment;
          this.monthlyIncome = r.monthlyIncome;
          this.monthlyDeductions = r.monthlyDeductions;
          this.monthlyHouseholdExpenses = r.monthlyHouseholdExpenses;
          this.assets = r.assets;
          this.liabilities = r.liabilities;
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to load affidavit data';
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  typeLabel(list: LookupItem[], id: number | null): string {
    if (id == null) return '';
    const found = list.find((x) => x.id === id);
    return found ? found.name : String(id);
  }

  goBack() {
    const queryParams: Record<string, string> = {};
    if (this.userId) queryParams['userId'] = this.userId;
    if (this.caseId) queryParams['caseId'] = this.caseId;

    void this.router.navigate(['/affidavit'], { queryParams });
  }

  finish() {
    this.goBack();
  }

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  stepTitle(): string {
    return this.steps[this.currentStepIndex]?.title ?? '';
  }

  isStepComplete(stepKey: (typeof this.steps)[number]['key']): boolean {
    switch (stepKey) {
      case 'employment':
        return this.employment.length > 0 || this.noneSelected.employment;
      case 'monthlyIncome':
        return this.monthlyIncome.length > 0 || this.noneSelected.monthlyIncome;
      case 'monthlyDeductions':
        return this.monthlyDeductions.length > 0 || this.noneSelected.monthlyDeductions;
      case 'monthlyHouseholdExpenses':
        return this.monthlyHouseholdExpenses.length > 0 || this.noneSelected.monthlyHouseholdExpenses;
      case 'assets':
        return this.assets.length > 0 || this.noneSelected.assets;
      case 'liabilities':
        return this.liabilities.length > 0 || this.noneSelected.liabilities;
      default:
        return false;
    }
  }

  completedStepCount(): number {
    return this.steps.filter((s) => this.isStepComplete(s.key)).length;
  }

  canGoBack(): boolean {
    return this.currentStepIndex > 0;
  }

  canGoNext(): boolean {
    return this.currentStepIndex < this.steps.length - 1;
  }

  prevStep() {
    if (!this.canGoBack()) return;
    this.currentStepIndex -= 1;
    this.syncCurrentStepKey();
  }

  goToStep(index: number) {
    if (index < 0 || index >= this.steps.length) return;
    this.currentStepIndex = index;
    this.syncCurrentStepKey();
  }

  /** Pay periods per year (must match server). */
  private payFrequencyToAnnualMultiplier(payFrequencyTypeId: number | null): number | null {
    switch (payFrequencyTypeId) {
      case 1: return 52;   // Weekly
      case 2: return 26;   // Bi-Weekly
      case 3: return 12;   // Monthly
      case 4: return 24;   // Bi-Monthly
      case 5: return 1;   // Annually
      case 6: return 2;   // Semi-Annually
      case 7: return 4;   // Quarterly
      case 8: return 260; // Daily (5 days/week)
      case 9: return 2080; // Hourly (40 hrs/week)
      default: return null;
    }
  }

  /** Annual income derived from Employment rows (pay rate × frequency). */
  private getEmploymentAnnual(): number {
    return this.employment.reduce((sum, row) => {
      const payRate = Number(row.payRate);
      const mult = this.payFrequencyToAnnualMultiplier(row.payFrequencyTypeId);
      if (!Number.isFinite(payRate) || payRate <= 0 || mult == null) return sum;
      return sum + payRate * mult;
    }, 0);
  }

  /** Sum of amounts for Monthly income rows with typeId 1 (Monthly gross salary or wages). */
  private getMonthlyIncomeType1Sum(): number {
    return this.monthlyIncome
      .filter((r) => r.typeId === 1)
      .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  }

  /** Returns true if both employment-derived monthly and type-1 monthly are present and differ beyond tolerance. */
  private checkMonthlyIncomeMismatch(): { mismatch: boolean; employmentMonthly: number; type1Monthly: number } {
    const employmentAnnual = this.getEmploymentAnnual();
    const employmentMonthly = employmentAnnual / 12;
    const type1Monthly = this.getMonthlyIncomeType1Sum();
    const tolerance = 0.50; // allow rounding within 50 cents
    const mismatch =
      employmentMonthly > 0 &&
      type1Monthly > 0 &&
      Math.abs(employmentMonthly - type1Monthly) > tolerance;
    return { mismatch, employmentMonthly, type1Monthly };
  }

  nextStep() {
    if (!this.canGoNext()) return;

    if (this.currentStepKey === 'monthlyIncome') {
      const { mismatch, employmentMonthly, type1Monthly } = this.checkMonthlyIncomeMismatch();
      if (mismatch) {
        this.monthlyIncomeMismatchMessage =
          `The monthly amount from Employment (${employmentMonthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) ` +
          `does not match the amount entered for "Monthly gross salary or wages" (${type1Monthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). ` +
          `Please fix the discrepancy, or choose "Continue anyway" to proceed.`;
        this.showMonthlyIncomeMismatchConfirm = true;
        return;
      }
    }

    this.currentStepIndex += 1;
    this.syncCurrentStepKey();
  }

  onConfirmMonthlyIncomeMismatchContinue(): void {
    this.showMonthlyIncomeMismatchConfirm = false;
    this.monthlyIncomeMismatchMessage = '';
    this.currentStepIndex += 1;
    this.syncCurrentStepKey();
  }

  onCancelMonthlyIncomeMismatch(): void {
    this.showMonthlyIncomeMismatchConfirm = false;
    this.monthlyIncomeMismatchMessage = '';
  }

  onSectionUpdateStart(): void {
    this.busy = true;
    this.error = null;
  }

  onSectionUpdateDone(): void {
    this.busy = false;
    this.refresh();
  }

  onSectionUpdateFailed(message: string): void {
    this.busy = false;
    this.error = message;
  }

  addEmployment(payload: EmploymentCreatePayload) {
    this.setNoneForStep('employment', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createEmployment(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add employment';
        }
      });
  }

  /** Opens confirm popup; actual remove runs on confirm. */
  requestRemove(id: string): void {
    this.pendingRemoveId = id;
    this.showRemoveConfirm = true;
  }

  onConfirmRemove(): void {
    const id = this.pendingRemoveId;
    this.pendingRemoveId = null;
    this.showRemoveConfirm = false;
    if (!id) return;
    switch (this.currentStepKey) {
      case 'employment':
        this.removeEmployment(id);
        break;
      case 'monthlyIncome':
        this.removeMonthlyIncome(id);
        break;
      case 'monthlyDeductions':
        this.removeMonthlyDeduction(id);
        break;
      case 'monthlyHouseholdExpenses':
        this.removeHouseholdExpense(id);
        break;
      case 'assets':
        this.removeAsset(id);
        break;
      case 'liabilities':
        this.removeLiability(id);
        break;
    }
  }

  onCancelRemove(): void {
    this.pendingRemoveId = null;
    this.showRemoveConfirm = false;
  }

  removeConfirmTitle(): string {
    const t = this.steps.find((s) => s.key === this.currentStepKey)?.title ?? 'item';
    return `Remove ${t}?`;
  }

  removeEmployment(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteEmployment(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove employment';
        }
      });
  }

  addMonthlyIncome(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyIncome', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createMonthlyIncome(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add monthly income';
        }
      });
  }

  removeMonthlyIncome(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteMonthlyIncome(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove monthly income';
        }
      });
  }

  updateMonthlyIncome(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid monthly income data';
      return;
    }

    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(
      this.api.patchMonthlyIncome(payload.id, body, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to update monthly income';
        }
      });
  }

  addMonthlyDeduction(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyDeductions', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createMonthlyDeductions(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add monthly deduction';
        }
      });
  }

  removeMonthlyDeduction(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteMonthlyDeductions(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove monthly deduction';
        }
      });
  }

  updateMonthlyDeduction(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid monthly deduction data';
      return;
    }

    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(
      this.api.patchMonthlyDeductions(payload.id, body, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to update monthly deduction';
        }
      });
  }

  addHouseholdExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyHouseholdExpenses', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createMonthlyHouseholdExpenses(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add household expense';
        }
      });
  }

  removeHouseholdExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteMonthlyHouseholdExpenses(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove household expense';
        }
      });
  }

  updateHouseholdExpense(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid household expense data';
      return;
    }

    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(
      this.api.patchMonthlyHouseholdExpenses(payload.id, body, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to update household expense';
        }
      });
  }

  addAsset(payload: AssetCreatePayload) {
    this.setNoneForStep('assets', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createAsset(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add asset';
        }
      });
  }

  removeAsset(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteAsset(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove asset';
        }
      });
  }

  addLiability(payload: LiabilityCreatePayload) {
    this.setNoneForStep('liabilities', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createLiability(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add liability';
        }
      });
  }

  removeLiability(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteLiability(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove liability';
        }
      });
  }
}
