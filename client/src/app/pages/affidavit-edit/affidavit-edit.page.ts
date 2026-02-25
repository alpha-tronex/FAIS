import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, forkJoin, from, map, of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AffidavitDataService, AssetRow, ContingentAssetRow, ContingentLiabilityRow, EmploymentRow, LiabilityRow, MonthlyLineRow } from '../../services/affidavit-data.service';
import { CasesService } from '../../services/cases.service';
import { LookupsService, LookupItem } from '../../services/lookups.service';
import { AssetCreatePayload } from './sections/affidavit-assets-section.component';
import { EmploymentCreatePayload } from './sections/affidavit-employment-section.component';
import { LiabilityCreatePayload } from './sections/affidavit-liabilities-section.component';
import { ContingentAssetCreatePayload } from './sections/affidavit-contingent-assets-section.component';
import { ContingentLiabilityCreatePayload } from './sections/affidavit-contingent-liabilities-section.component';
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

  /** Full name of the petitioner when editing in case context (from case list). */
  petitionerDisplayName: string | null = null;

  steps = [
    { key: 'employment', title: 'Employment' },
    { key: 'monthlyIncome', title: 'Monthly income' },
    { key: 'monthlyDeductions', title: 'Monthly deductions' },
    { key: 'monthlyHouseholdExpenses', title: 'Monthly household expenses' },
    { key: 'monthlyAutomobileExpenses', title: 'Monthly automobile expenses' },
    { key: 'monthlyChildrenExpenses', title: 'Monthly children expenses' },
    { key: 'monthlyChildrenOtherExpenses', title: 'Monthly children other expenses' },
    { key: 'monthlyCreditorsExpenses', title: 'Monthly creditors expenses' },
    { key: 'monthlyInsuranceExpenses', title: 'Monthly insurance expenses' },
    { key: 'monthlyOtherExpenses', title: 'Monthly other expenses' },
    { key: 'assets', title: 'Assets' },
    { key: 'liabilities', title: 'Liabilities' },
    { key: 'contingentAssets', title: 'Contingent assets' },
    { key: 'contingentLiabilities', title: 'Contingent liabilities' }
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
    monthlyAutomobileExpenses: false,
    monthlyChildrenExpenses: false,
    monthlyChildrenOtherExpenses: false,
    monthlyCreditorsExpenses: false,
    monthlyInsuranceExpenses: false,
    monthlyOtherExpenses: false,
    assets: false,
    liabilities: false,
    contingentAssets: false,
    contingentLiabilities: false
  };

  // Lookups
  payFrequencies: LookupItem[] = [];
  incomeTypes: LookupItem[] = [];
  deductionTypes: LookupItem[] = [];
  householdExpenseTypes: LookupItem[] = [];
  automobileExpenseTypes: LookupItem[] = [];
  childrenExpenseTypes: LookupItem[] = [];
  childrenOtherExpenseTypes: LookupItem[] = [];
  creditorsExpenseTypes: LookupItem[] = [];
  insuranceExpenseTypes: LookupItem[] = [];
  otherExpenseTypes: LookupItem[] = [];
  assetsTypes: LookupItem[] = [];
  liabilitiesTypes: LookupItem[] = [];
  nonMaritalTypes: LookupItem[] = [];

  // Data
  employment: EmploymentRow[] = [];
  monthlyIncome: MonthlyLineRow[] = [];
  monthlyDeductions: MonthlyLineRow[] = [];
  monthlyHouseholdExpenses: MonthlyLineRow[] = [];
  monthlyAutomobileExpenses: MonthlyLineRow[] = [];
  monthlyChildrenExpenses: MonthlyLineRow[] = [];
  monthlyChildrenOtherExpenses: MonthlyLineRow[] = [];
  monthlyCreditorsExpenses: MonthlyLineRow[] = [];
  monthlyInsuranceExpenses: MonthlyLineRow[] = [];
  monthlyOtherExpenses: MonthlyLineRow[] = [];
  assets: AssetRow[] = [];
  liabilities: LiabilityRow[] = [];
  contingentAssets: ContingentAssetRow[] = [];
  contingentLiabilities: ContingentLiabilityRow[] = [];

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
    private readonly casesApi: CasesService,
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

    this.loadPetitionerDisplayName();

    this.syncCurrentStepKey();
    this.loadNoneSelections();

    this.refresh();
  }

  private loadPetitionerDisplayName(): void {
    if (!this.caseId) {
      this.petitionerDisplayName = null;
      return;
    }
    from(this.casesApi.list()).subscribe({
      next: (cases) => {
        const c = cases.find((x) => x.id === this.caseId);
        if (c?.petitioner) {
          const p = c.petitioner;
          const name = [p.lastName?.trim(), p.firstName?.trim()].filter(Boolean).join(', ');
          this.petitionerDisplayName = name || p.uname || null;
        } else {
          this.petitionerDisplayName = null;
        }
      },
      error: () => {
        this.petitionerDisplayName = null;
      }
    });
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
      this.loadPetitionerDisplayName();
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
      case 'monthlyAutomobileExpenses':
        return this.monthlyAutomobileExpenses.length > 0;
      case 'monthlyChildrenExpenses':
        return this.monthlyChildrenExpenses.length > 0;
      case 'monthlyChildrenOtherExpenses':
        return this.monthlyChildrenOtherExpenses.length > 0;
      case 'monthlyCreditorsExpenses':
        return this.monthlyCreditorsExpenses.length > 0;
      case 'monthlyInsuranceExpenses':
        return this.monthlyInsuranceExpenses.length > 0;
      case 'monthlyOtherExpenses':
        return this.monthlyOtherExpenses.length > 0;
      case 'assets':
        return this.assets.length > 0;
      case 'liabilities':
        return this.liabilities.length > 0;
      case 'contingentAssets':
        return this.contingentAssets.length > 0;
      case 'contingentLiabilities':
        return this.contingentLiabilities.length > 0;
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
              : stepKey === 'monthlyAutomobileExpenses'
                ? this.monthlyAutomobileExpenses.length === 0
                  ? of(undefined)
                  : forkJoin(this.monthlyAutomobileExpenses.map((r) => from(this.api.deleteMonthlyAutomobileExpenses(r.id, uid)))).pipe(
                      map(() => undefined)
                    )
                : stepKey === 'monthlyChildrenExpenses'
                  ? this.monthlyChildrenExpenses.length === 0
                    ? of(undefined)
                    : forkJoin(this.monthlyChildrenExpenses.map((r) => from(this.api.deleteMonthlyChildrenExpenses(r.id, uid)))).pipe(
                        map(() => undefined)
                      )
                  : stepKey === 'monthlyChildrenOtherExpenses'
                    ? this.monthlyChildrenOtherExpenses.length === 0
                      ? of(undefined)
                      : forkJoin(
                          this.monthlyChildrenOtherExpenses.map((r) => from(this.api.deleteMonthlyChildrenOtherExpenses(r.id, uid)))
                        ).pipe(map(() => undefined))
                    : stepKey === 'monthlyCreditorsExpenses'
                      ? this.monthlyCreditorsExpenses.length === 0
                        ? of(undefined)
                        : forkJoin(this.monthlyCreditorsExpenses.map((r) => from(this.api.deleteMonthlyCreditorsExpenses(r.id, uid)))).pipe(
                            map(() => undefined)
                          )
                      : stepKey === 'monthlyInsuranceExpenses'
                        ? this.monthlyInsuranceExpenses.length === 0
                          ? of(undefined)
                          : forkJoin(this.monthlyInsuranceExpenses.map((r) => from(this.api.deleteMonthlyInsuranceExpenses(r.id, uid)))).pipe(
                              map(() => undefined)
                            )
                        : stepKey === 'monthlyOtherExpenses'
                          ? this.monthlyOtherExpenses.length === 0
                            ? of(undefined)
                            : forkJoin(this.monthlyOtherExpenses.map((r) => from(this.api.deleteMonthlyOtherExpenses(r.id, uid)))).pipe(
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
                          : stepKey === 'contingentAssets'
                            ? this.contingentAssets.length === 0
                              ? of(undefined)
                              : forkJoin(this.contingentAssets.map((a) => from(this.api.deleteContingentAsset(a.id, uid)))).pipe(
                                  map(() => undefined)
                                )
                            : stepKey === 'contingentLiabilities'
                              ? this.contingentLiabilities.length === 0
                                ? of(undefined)
                                : forkJoin(this.contingentLiabilities.map((l) => from(this.api.deleteContingentLiability(l.id, uid)))).pipe(
                                    map(() => undefined)
                                  )
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
      case 'monthlyAutomobileExpenses':
        return 'I have no monthly automobile expenses to report';
      case 'monthlyChildrenExpenses':
        return 'I have no monthly children expenses to report';
      case 'monthlyChildrenOtherExpenses':
        return 'I have no monthly children other expenses to report';
      case 'monthlyCreditorsExpenses':
        return 'I have no monthly creditors expenses to report';
      case 'monthlyInsuranceExpenses':
        return 'I have no monthly insurance expenses to report';
      case 'monthlyOtherExpenses':
        return 'I have no monthly other expenses to report';
      case 'liabilities':
        return 'I have no liabilities to report';
      case 'contingentAssets':
        return 'I have no contingent assets to report';
      case 'contingentLiabilities':
        return 'I have no contingent liabilities to report';
      case 'assets':
        return 'I have no assets to report';
      default:
        return 'Nothing to report for this section';
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private loadAll(userId?: string, caseId?: string) {
    return forkJoin({
      payFrequencies: from(this.lookups.list('pay-frequency-types')),
      incomeTypes: from(this.lookups.list('monthly-income-types')),
      deductionTypes: from(this.lookups.list('monthly-deduction-types')),
      householdExpenseTypes: from(this.lookups.list('monthly-household-expense-types')),
      automobileExpenseTypes: from(this.lookups.list('monthly-automobile-expense-types')),
      childrenExpenseTypes: from(this.lookups.list('monthly-children-expense-types')),
      childrenOtherExpenseTypes: from(this.lookups.list('monthly-children-other-expense-types')),
      creditorsExpenseTypes: from(this.lookups.list('monthly-creditors-expense-types')),
      insuranceExpenseTypes: from(this.lookups.list('monthly-insurance-expense-types')),
      otherExpenseTypes: from(this.lookups.list('monthly-other-expense-types')),
      assetsTypes: from(this.lookups.list('assets-types')),
      liabilitiesTypes: from(this.lookups.list('liabilities-types')),
      nonMaritalTypes: from(this.lookups.list('non-marital-types')),

      employment: from(this.api.listEmployment(userId, caseId)),
      monthlyIncome: from(this.api.listMonthlyIncome(userId, caseId)),
      monthlyDeductions: from(this.api.listMonthlyDeductions(userId, caseId)),
      monthlyHouseholdExpenses: from(this.api.listMonthlyHouseholdExpenses(userId, caseId)),
      monthlyAutomobileExpenses: from(this.api.listMonthlyAutomobileExpenses(userId, caseId)),
      monthlyChildrenExpenses: from(this.api.listMonthlyChildrenExpenses(userId, caseId)),
      monthlyChildrenOtherExpenses: from(this.api.listMonthlyChildrenOtherExpenses(userId, caseId)),
      monthlyCreditorsExpenses: from(this.api.listMonthlyCreditorsExpenses(userId, caseId)),
      monthlyInsuranceExpenses: from(this.api.listMonthlyInsuranceExpenses(userId, caseId)),
      monthlyOtherExpenses: from(this.api.listMonthlyOtherExpenses(userId, caseId)),
      assets: from(this.api.listAssets(userId, caseId)),
      liabilities: from(this.api.listLiabilities(userId, caseId)),
      contingentAssets: from(this.api.listContingentAssets(userId, caseId)),
      contingentLiabilities: from(this.api.listContingentLiabilities(userId, caseId))
    });
  }

  refresh() {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;

    this.subscription = this.loadAll(this.userId || undefined, this.caseId || undefined)
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
          this.automobileExpenseTypes = r.automobileExpenseTypes;
          this.childrenExpenseTypes = r.childrenExpenseTypes;
          this.childrenOtherExpenseTypes = r.childrenOtherExpenseTypes;
          this.creditorsExpenseTypes = r.creditorsExpenseTypes;
          this.insuranceExpenseTypes = r.insuranceExpenseTypes;
          this.otherExpenseTypes = r.otherExpenseTypes;
          this.assetsTypes = r.assetsTypes;
          this.liabilitiesTypes = r.liabilitiesTypes;
          this.nonMaritalTypes = r.nonMaritalTypes;

          this.employment = r.employment;
          this.monthlyIncome = r.monthlyIncome;
          this.monthlyDeductions = r.monthlyDeductions;
          this.monthlyHouseholdExpenses = r.monthlyHouseholdExpenses;
          this.monthlyAutomobileExpenses = r.monthlyAutomobileExpenses;
          this.monthlyChildrenExpenses = r.monthlyChildrenExpenses;
          this.monthlyChildrenOtherExpenses = r.monthlyChildrenOtherExpenses;
          this.monthlyCreditorsExpenses = r.monthlyCreditorsExpenses;
          this.monthlyInsuranceExpenses = r.monthlyInsuranceExpenses;
          this.monthlyOtherExpenses = r.monthlyOtherExpenses;
          this.assets = r.assets;
          this.liabilities = r.liabilities;
          this.contingentAssets = r.contingentAssets;
          this.contingentLiabilities = r.contingentLiabilities;
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

    if (this.hideNav) {
      void this.router.navigate(['/admin', 'affidavit'], { queryParams });
    } else {
      void this.router.navigateByUrl('/my-cases');
    }
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
      case 'monthlyAutomobileExpenses':
        return this.monthlyAutomobileExpenses.length > 0 || this.noneSelected.monthlyAutomobileExpenses;
      case 'monthlyChildrenExpenses':
        return this.monthlyChildrenExpenses.length > 0 || this.noneSelected.monthlyChildrenExpenses;
      case 'monthlyChildrenOtherExpenses':
        return this.monthlyChildrenOtherExpenses.length > 0 || this.noneSelected.monthlyChildrenOtherExpenses;
      case 'monthlyCreditorsExpenses':
        return this.monthlyCreditorsExpenses.length > 0 || this.noneSelected.monthlyCreditorsExpenses;
      case 'monthlyInsuranceExpenses':
        return this.monthlyInsuranceExpenses.length > 0 || this.noneSelected.monthlyInsuranceExpenses;
      case 'monthlyOtherExpenses':
        return this.monthlyOtherExpenses.length > 0 || this.noneSelected.monthlyOtherExpenses;
      case 'assets':
        return this.assets.length > 0;
      case 'liabilities':
        return this.liabilities.length > 0;
      case 'contingentAssets':
        return this.contingentAssets.length > 0 || this.noneSelected.contingentAssets;
      case 'contingentLiabilities':
        return this.contingentLiabilities.length > 0 || this.noneSelected.contingentLiabilities;
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
      this.api.createEmployment(payload, this.userId || undefined, this.caseId || undefined)
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
      case 'monthlyAutomobileExpenses':
        this.removeMonthlyAutomobileExpense(id);
        break;
      case 'monthlyChildrenExpenses':
        this.removeMonthlyChildrenExpense(id);
        break;
      case 'monthlyChildrenOtherExpenses':
        this.removeMonthlyChildrenOtherExpense(id);
        break;
      case 'monthlyCreditorsExpenses':
        this.removeMonthlyCreditorsExpense(id);
        break;
      case 'monthlyInsuranceExpenses':
        this.removeMonthlyInsuranceExpense(id);
        break;
      case 'monthlyOtherExpenses':
        this.removeMonthlyOtherExpense(id);
        break;
      case 'assets':
        this.removeAsset(id);
        break;
      case 'liabilities':
        this.removeLiability(id);
        break;
      case 'contingentAssets':
        this.removeContingentAsset(id);
        break;
      case 'contingentLiabilities':
        this.removeContingentLiability(id);
        break;
      default:
        // Exhaustiveness: all step keys handled above
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

    this.subscription = from(this.api.deleteEmployment(id, this.userId || undefined, this.caseId || undefined))
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
      this.api.createMonthlyIncome(payload, this.userId || undefined, this.caseId || undefined)
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

    this.subscription = from(this.api.deleteMonthlyIncome(id, this.userId || undefined, this.caseId || undefined))
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
      this.api.patchMonthlyIncome(payload.id, body, this.userId || undefined, this.caseId || undefined)
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
      this.api.createMonthlyDeductions(payload, this.userId || undefined, this.caseId || undefined)
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

    this.subscription = from(this.api.deleteMonthlyDeductions(id, this.userId || undefined, this.caseId || undefined))
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
      this.api.patchMonthlyDeductions(payload.id, body, this.userId || undefined, this.caseId || undefined)
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
      this.api.createMonthlyHouseholdExpenses(payload, this.userId || undefined, this.caseId || undefined)
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

    this.subscription = from(this.api.deleteMonthlyHouseholdExpenses(id, this.userId || undefined, this.caseId || undefined))
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
      this.api.patchMonthlyHouseholdExpenses(payload.id, body, this.userId || undefined, this.caseId || undefined)
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

  addMonthlyAutomobileExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyAutomobileExpenses', false);
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.createMonthlyAutomobileExpenses(payload, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to add automobile expense')
      });
  }

  removeMonthlyAutomobileExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.deleteMonthlyAutomobileExpenses(id, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to remove automobile expense')
      });
  }

  updateMonthlyAutomobileExpense(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid automobile expense data';
      return;
    }
    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(this.api.patchMonthlyAutomobileExpenses(payload.id, body, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to update automobile expense')
      });
  }

  addMonthlyChildrenExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyChildrenExpenses', false);
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.createMonthlyChildrenExpenses(payload, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to add children expense')
      });
  }

  removeMonthlyChildrenExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.deleteMonthlyChildrenExpenses(id, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to remove children expense')
      });
  }

  updateMonthlyChildrenExpense(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid children expense data';
      return;
    }
    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(this.api.patchMonthlyChildrenExpenses(payload.id, body, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to update children expense')
      });
  }

  addMonthlyChildrenOtherExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyChildrenOtherExpenses', false);
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.createMonthlyChildrenOtherExpenses(payload, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to add children other expense')
      });
  }

  removeMonthlyChildrenOtherExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.deleteMonthlyChildrenOtherExpenses(id, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to remove children other expense')
      });
  }

  updateMonthlyChildrenOtherExpense(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid children other expense data';
      return;
    }
    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(this.api.patchMonthlyChildrenOtherExpenses(payload.id, body, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to update children other expense')
      });
  }

  addMonthlyCreditorsExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyCreditorsExpenses', false);
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.createMonthlyCreditorsExpenses(payload, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to add creditors expense')
      });
  }

  removeMonthlyCreditorsExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.deleteMonthlyCreditorsExpenses(id, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to remove creditors expense')
      });
  }

  updateMonthlyCreditorsExpense(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid creditors expense data';
      return;
    }
    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(this.api.patchMonthlyCreditorsExpenses(payload.id, body, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to update creditors expense')
      });
  }

  addMonthlyInsuranceExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyInsuranceExpenses', false);
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.createMonthlyInsuranceExpenses(payload, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to add insurance expense')
      });
  }

  removeMonthlyInsuranceExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.deleteMonthlyInsuranceExpenses(id, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to remove insurance expense')
      });
  }

  updateMonthlyInsuranceExpense(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid insurance expense data';
      return;
    }
    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(this.api.patchMonthlyInsuranceExpenses(payload.id, body, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to update insurance expense')
      });
  }

  addMonthlyOtherExpense(payload: MonthlyLineCreatePayload) {
    this.setNoneForStep('monthlyOtherExpenses', false);
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.createMonthlyOtherExpenses(payload, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to add other expense')
      });
  }

  removeMonthlyOtherExpense(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    this.subscription = from(this.api.deleteMonthlyOtherExpenses(id, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to remove other expense')
      });
  }

  updateMonthlyOtherExpense(payload: MonthlyLineUpdatePayload) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;
    const typeId = Number(payload.typeId);
    const amount = Number(payload.amount);
    if (!Number.isFinite(typeId) || !Number.isFinite(amount)) {
      this.busy = false;
      this.error = 'Invalid other expense data';
      return;
    }
    const body = { typeId, amount, ifOther: payload.ifOther ?? null };
    this.subscription = from(this.api.patchMonthlyOtherExpenses(payload.id, body, this.userId || undefined, this.caseId || undefined))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => (this.error = e?.error?.error ?? 'Failed to update other expense')
      });
  }

  addAsset(payload: AssetCreatePayload) {
    this.setNoneForStep('assets', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createAsset(payload, this.userId || undefined, this.caseId || undefined)
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

    this.subscription = from(this.api.deleteAsset(id, this.userId || undefined, this.caseId || undefined))
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
      this.api.createLiability(payload, this.userId || undefined, this.caseId || undefined)
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

    this.subscription = from(this.api.deleteLiability(id, this.userId || undefined, this.caseId || undefined))
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

  addContingentAsset(payload: ContingentAssetCreatePayload) {
    this.setNoneForStep('contingentAssets', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createContingentAsset(payload, this.userId || undefined, this.caseId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add contingent asset';
        }
      });
  }

  removeContingentAsset(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteContingentAsset(id, this.userId || undefined, this.caseId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove contingent asset';
        }
      });
  }

  addContingentLiability(payload: ContingentLiabilityCreatePayload) {
    this.setNoneForStep('contingentLiabilities', false);

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(
      this.api.createContingentLiability(payload, this.userId || undefined, this.caseId || undefined)
    )
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to add contingent liability';
        }
      });
  }

  removeContingentLiability(id: string) {
    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.api.deleteContingentLiability(id, this.userId || undefined, this.caseId || undefined))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: () => this.refresh(),
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to remove contingent liability';
        }
      });
  }
}
