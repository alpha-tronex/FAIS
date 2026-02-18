import { ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, forkJoin, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AffidavitDataService, AssetRow, EmploymentRow, LiabilityRow, MonthlyLineRow } from '../../services/affidavit-data.service';
import { LookupsService, LookupItem } from '../../services/lookups.service';
import { AssetCreatePayload } from './sections/affidavit-assets-section.component';
import { EmploymentCreatePayload } from './sections/affidavit-employment-section.component';
import { LiabilityCreatePayload } from './sections/affidavit-liabilities-section.component';
import { MonthlyLineCreatePayload } from './sections/affidavit-monthly-lines-section.component';

@Component({
  standalone: false,
  selector: 'app-affidavit-edit-page',
  templateUrl: './affidavit-edit.page.html',
  styleUrl: './affidavit-edit.page.css'
})
export class AffidavitEditPage implements OnInit, OnChanges, OnDestroy {
  @Input() userId: string | null = null;
  @Input() caseId: string | null = null;

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

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly api: AffidavitDataService,
    private readonly lookups: LookupsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
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
      this.cdr.markForCheck();
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
    this.cdr.markForCheck();
  }

  setNoneForStep(stepKey: (typeof this.steps)[number]['key'], value: boolean) {
    this.noneSelected[stepKey] = value;
    localStorage.setItem(this.storageKey(stepKey), value ? '1' : '0');

    const shouldAdvance = value && !this.busy && stepKey === this.currentStepKey && this.canGoNext();

    // Keep the checkbox controlled for the current step.
    this.currentNoneSelected = Boolean(this.noneSelected[this.currentStepKey]);
    this.cdr.markForCheck();

    if (shouldAdvance) {
      // Defer step change so ngModel/DOM state doesn't "stick" across steps.
      setTimeout(() => {
        if (this.busy) return;
        if (!this.canGoNext()) return;
        if (this.currentStepKey !== stepKey) return;

        this.currentStepIndex += 1;
        this.syncCurrentStepKey();
        this.cdr.markForCheck();
      }, 0);
    }
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
    this.cdr.markForCheck();

    this.subscription = this.loadAll(this.userId || undefined)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
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

          this.cdr.markForCheck();
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to load affidavit data';
          this.cdr.markForCheck();
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
    this.cdr.markForCheck();
  }

  nextStep() {
    if (!this.canGoNext()) return;
    this.currentStepIndex += 1;
    this.syncCurrentStepKey();
    this.cdr.markForCheck();
  }

  addEmployment(payload: EmploymentCreatePayload) {
    this.setNoneForStep('employment', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(
      this.api.createEmployment(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add employment';
          this.cdr.markForCheck();
        }
      });
  }

  removeEmployment(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(this.api.deleteEmployment(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove employment';
          this.cdr.markForCheck();
        }
      });
  }

  addMonthlyIncome(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyIncome', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(
      this.api.createMonthlyIncome(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add monthly income';
          this.cdr.markForCheck();
        }
      });
  }

  removeMonthlyIncome(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(this.api.deleteMonthlyIncome(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove monthly income';
          this.cdr.markForCheck();
        }
      });
  }

  addMonthlyDeduction(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyDeductions', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(
      this.api.createMonthlyDeductions(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add monthly deduction';
          this.cdr.markForCheck();
        }
      });
  }

  removeMonthlyDeduction(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(this.api.deleteMonthlyDeductions(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove monthly deduction';
          this.cdr.markForCheck();
        }
      });
  }

  addHouseholdExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyHouseholdExpenses', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(
      this.api.createMonthlyHouseholdExpenses(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add household expense';
          this.cdr.markForCheck();
        }
      });
  }

  removeHouseholdExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(this.api.deleteMonthlyHouseholdExpenses(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove household expense';
          this.cdr.markForCheck();
        }
      });
  }

  addAsset(payload: AssetCreatePayload) {
    this.setNoneForStep('assets', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(
      this.api.createAsset(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add asset';
          this.cdr.markForCheck();
        }
      });
  }

  removeAsset(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(this.api.deleteAsset(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove asset';
          this.cdr.markForCheck();
        }
      });
  }

  addLiability(payload: LiabilityCreatePayload) {
    this.setNoneForStep('liabilities', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(
      this.api.createLiability(payload, this.userId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add liability';
          this.cdr.markForCheck();
        }
      });
  }

  removeLiability(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.subscription = from(this.api.deleteLiability(id, this.userId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove liability';
          this.cdr.markForCheck();
        }
      });
  }
}
