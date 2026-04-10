import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription, forkJoin, from } from 'rxjs';
import { finalize, switchMap } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { CasesService, CaseListItem } from '../../services/cases.service';
import { LookupsService, LookupItem } from '../../services/lookups.service';
import { UsersService, UserListItem } from '../../services/users.service';

type LoadAllResult = {
  users: UserListItem[];
  cases: CaseListItem[];
  circuits: LookupItem[];
  counties: LookupItem[];
  divisions: LookupItem[];
};

@Component({
  standalone: false,
  selector: 'app-cases-page',
  templateUrl: './cases.page.html',
  styleUrl: './cases.page.css'
})
export class CasesPage implements OnInit, OnDestroy {
  users: UserListItem[] = [];
  petitioners: UserListItem[] = [];
  respondents: UserListItem[] = [];
  petitionerAttorneys: UserListItem[] = [];
  respondentAttorneys: UserListItem[] = [];
  legalAssistants: UserListItem[] = [];
  cases: CaseListItem[] = [];
  circuits: LookupItem[] = [];
  allCounties: LookupItem[] = [];
  counties: LookupItem[] = [];
  divisions: LookupItem[] = [];

  caseNumber = '';
  division = '';
  circuitId: number | null = null;
  countyId: number | null = null;
  numChildren: number | null = null;
  childSupportWorksheetFiled: boolean | null = null;
  petitionerId = '';
  respondentId = '';
  petitionerAttId = '';
  respondentAttId = '';
  legalAssistantId = '';

  editingCaseId: string | null = null;
  /** When editing a case, true if that case is archived (show banner + restore). */
  editingCaseArchivedAt: string | null = null;

  busy = false;
  error: string | null = null;
  success: string | null = null;

  canCreate = false;

  /** Current sort column for All cases table. */
  casesSortColumn: 'caseNumber' | 'division' | 'petitioner' | 'respondent' = 'caseNumber';
  /** Sort direction for All cases table. */
  casesSortDirection: 'asc' | 'desc' = 'asc';

  /** 'active' = active cases (default), 'archived' = archived only (admin). */
  casesView: 'active' | 'archived' = 'active';

  /** All cases table pagination (client-side over sorted list). */
  readonly casesPageSize = 10;
  casesPageIndex = 0;

  /**
   * Filters for the All cases table only (independent of create/edit form).
   * Circuit + county are paired: county options follow the selected circuit.
   */
  listFilterCircuitId: number | null = null;
  listFilterCountyId: number | null = null;
  /** Empty string = any division. */
  listFilterDivision = '';
  /** Worksheet filed tri-state filter. */
  listFilterWorksheet: 'any' | 'yes' | 'no' | 'unspecified' = 'any';

  showArchiveConfirm = false;
  caseToArchive: CaseListItem | null = null;
  showRestoreConfirm = false;
  caseToRestore: CaseListItem | null = null;
  archiveRestoreBusy = false;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly usersApi: UsersService,
    private readonly casesApi: CasesService,
    private readonly lookups: LookupsService,
    private readonly router: Router
  ) {
  }

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    this.canCreate = this.auth.isAdmin();
    this.refresh();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  displayName(u: Pick<UserListItem, 'uname' | 'firstName' | 'lastName'>): string {
    const name = `${u.lastName ?? ''}, ${u.firstName ?? ''}`.replace(/^,\s*|,\s*$/g, '').trim();
    return name ? `${name} (${u.uname})` : u.uname;
  }

  /** Petitioner display for table cell (lastName, firstName). */
  petitionerLabel(c: CaseListItem): string {
    if (!c.petitioner) return '';
    return `${c.petitioner.lastName ?? ''}, ${c.petitioner.firstName ?? ''}`.trim();
  }

  /** Respondent display for table cell (lastName, firstName). */
  respondentLabel(c: CaseListItem): string {
    if (!c.respondent) return '';
    return `${c.respondent.lastName ?? ''}, ${c.respondent.firstName ?? ''}`.trim();
  }

  /** Counties available for the table’s circuit filter (all counties if no circuit selected). */
  get listFilterCounties(): LookupItem[] {
    if (this.listFilterCircuitId == null) {
      return this.allCounties;
    }
    const filtered = this.allCounties.filter((c) => c.circuitId === this.listFilterCircuitId);
    return filtered.length > 0 ? filtered : this.allCounties;
  }

  /** Cases after list filters (before sort). */
  get filteredCases(): CaseListItem[] {
    return this.cases.filter((c) => {
      if (this.listFilterCircuitId != null && c.circuitId !== this.listFilterCircuitId) {
        return false;
      }
      if (this.listFilterCountyId != null && c.countyId !== this.listFilterCountyId) {
        return false;
      }
      if (this.listFilterDivision.trim() !== '' && (c.division ?? '') !== this.listFilterDivision) {
        return false;
      }
      const ws = c.childSupportWorksheetFiled;
      switch (this.listFilterWorksheet) {
        case 'any':
          break;
        case 'yes':
          if (ws !== true) return false;
          break;
        case 'no':
          if (ws !== false) return false;
          break;
        case 'unspecified':
          if (ws != null) return false;
          break;
        default:
          break;
      }
      return true;
    });
  }

  /** Cases sorted by current casesSortColumn and casesSortDirection. */
  get sortedCases(): CaseListItem[] {
    const col = this.casesSortColumn;
    const dir = this.casesSortDirection === 'asc' ? 1 : -1;
    return [...this.filteredCases].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (col) {
        case 'caseNumber':
          aVal = a.caseNumber ?? '';
          bVal = b.caseNumber ?? '';
          break;
        case 'division':
          aVal = a.division ?? '';
          bVal = b.division ?? '';
          break;
        case 'petitioner':
          aVal = this.petitionerLabel(a);
          bVal = this.petitionerLabel(b);
          break;
        case 'respondent':
          aVal = this.respondentLabel(a);
          bVal = this.respondentLabel(b);
          break;
        default:
          return 0;
      }
      const aStr = String(aVal);
      const bStr = String(bVal);
      return dir * (aStr === bStr ? 0 : aStr < bStr ? -1 : 1);
    });
  }

  /** Rows for the current cases table page. */
  get pagedCases(): CaseListItem[] {
    const start = this.casesPageIndex * this.casesPageSize;
    return this.sortedCases.slice(start, start + this.casesPageSize);
  }

  get casesPageCount(): number {
    return Math.max(1, Math.ceil(this.sortedCases.length / this.casesPageSize));
  }

  get casesRangeStart(): number {
    if (this.sortedCases.length === 0) return 0;
    return this.casesPageIndex * this.casesPageSize + 1;
  }

  get casesRangeEnd(): number {
    return Math.min((this.casesPageIndex + 1) * this.casesPageSize, this.sortedCases.length);
  }

  casesPrevPage(): void {
    this.casesPageIndex = Math.max(0, this.casesPageIndex - 1);
  }

  casesNextPage(): void {
    this.casesPageIndex = Math.min(this.casesPageCount - 1, this.casesPageIndex + 1);
  }

  private clampCasesPageIndex(): void {
    const last = Math.max(0, this.casesPageCount - 1);
    if (this.casesPageIndex > last) this.casesPageIndex = last;
  }

  /** Toggle sort on column: same column flips direction, new column sets asc. */
  setCasesSort(column: 'caseNumber' | 'division' | 'petitioner' | 'respondent'): void {
    if (this.casesSortColumn === column) {
      this.casesSortDirection = this.casesSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.casesSortColumn = column;
      this.casesSortDirection = 'asc';
    }
    this.clampCasesPageIndex();
  }

  /** True if the given column is the current sort column. */
  isCasesSortColumn(column: 'caseNumber' | 'division' | 'petitioner' | 'respondent'): boolean {
    return this.casesSortColumn === column;
  }

  onCasesListFilterChange(): void {
    this.casesPageIndex = 0;
    this.clampCasesPageIndex();
  }

  onCasesListCircuitFilterChange(): void {
    if (
      this.listFilterCountyId != null &&
      !this.listFilterCounties.some((x) => x.id === this.listFilterCountyId)
    ) {
      this.listFilterCountyId = null;
    }
    this.onCasesListFilterChange();
  }

  clearCasesListFilters(): void {
    this.listFilterCircuitId = null;
    this.listFilterCountyId = null;
    this.listFilterDivision = '';
    this.listFilterWorksheet = 'any';
    this.onCasesListFilterChange();
  }

  private applyUserTypeFilters() {
    // Create-case dropdowns are filtered by the simplified RoleType IDs.
    // 1 Petitioner, 2 Respondent, 3 Petitioner Attorney, 4 Respondent Attorney, 5 Administrator, 6 Legal Assistant
    const petitioners = this.users.filter((u) => u.roleTypeId === 1);
    const respondents = this.users.filter((u) => u.roleTypeId === 2);
    const petitionerAttorneys = this.users.filter((u) => u.roleTypeId === 3);
    const respondentAttorneys = this.users.filter((u) => u.roleTypeId === 4);
    const legalAssistants = this.users.filter((u) => u.roleTypeId === 6);

    this.petitioners = petitioners;
    this.respondents = respondents;
    this.petitionerAttorneys = petitionerAttorneys;
    this.respondentAttorneys = respondentAttorneys;
    this.legalAssistants = legalAssistants;

    // Keep selections if still valid; otherwise clear.
    if (this.petitionerId && !this.petitioners.some((u) => u.id === this.petitionerId)) this.petitionerId = '';
    if (this.respondentId && !this.respondents.some((u) => u.id === this.respondentId)) this.respondentId = '';
    if (this.petitionerAttId && !this.petitionerAttorneys.some((u) => u.id === this.petitionerAttId)) this.petitionerAttId = '';
    if (this.respondentAttId && !this.respondentAttorneys.some((u) => u.id === this.respondentAttId)) this.respondentAttId = '';
    if (this.legalAssistantId && !this.legalAssistants.some((u) => u.id === this.legalAssistantId)) this.legalAssistantId = '';
  }

  private loadAll(showArchivedCases?: boolean) {
    return forkJoin({
      users: from(this.usersApi.list()),
      cases: from(this.casesApi.list(undefined, showArchivedCases === true)),
      circuits: from(this.lookups.list('circuits')),
      counties: from(this.lookups.list('counties')),
      divisions: from(this.lookups.list('divisions'))
    }) as Observable<LoadAllResult>;
  }

  private applyCountyFilter() {
    const circuitId = this.circuitId;
    if (circuitId == null) {
      this.counties = this.allCounties;
    } else {
      const filtered = this.allCounties.filter((c) => c.circuitId === circuitId);
      this.counties = filtered.length > 0 ? filtered : this.allCounties;
    }

    if (this.counties.length === 0) {
      this.countyId = null;
      return;
    }

    if (this.countyId == null || !this.counties.some((c) => c.id === this.countyId)) {
      this.countyId = this.counties[0]!.id;
    }
  }

  private resetForm() {
    this.caseNumber = '';
    this.division = '';
    this.numChildren = null;
    this.childSupportWorksheetFiled = null;
    this.petitionerId = '';
    this.respondentId = '';
    this.petitionerAttId = '';
    this.respondentAttId = '';
    this.legalAssistantId = '';
    this.editingCaseId = null;
    this.editingCaseArchivedAt = null;

    if (this.circuits.length > 0) {
      this.circuitId = this.circuits[0]!.id;
    }
    if (this.divisions.length > 0) {
      this.division = this.divisions[0]!.name;
    }
    this.applyCountyFilter();
  }

  refresh() {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;
    this.success = null;

    const showArchived = this.casesView === 'archived';
    this.subscription = this.loadAll(showArchived)
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: ({ users, cases, circuits, counties, divisions }) => {
          this.users = users;
          this.applyUserTypeFilters();
          this.cases = cases;
          this.circuits = circuits;
          this.allCounties = counties;
          this.divisions = divisions;

          if (this.circuitId == null && this.circuits.length > 0) {
            this.circuitId = this.circuits[0]!.id;
          }

          if (!this.division && this.divisions.length > 0) {
            this.division = this.divisions[0]!.name;
          }

          this.applyCountyFilter();
          this.clampCasesPageIndex();
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to load cases';
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  onCircuitChange() {
    this.applyCountyFilter();
  }

  onCancelEdit() {
    this.resetForm();
  }

  create() {
    if (!this.canCreate) {
      this.error = 'Forbidden';
      return;
    }

    if (this.circuitId == null || this.countyId == null) {
      this.error = 'Circuit and County are required.';
      return;
    }

    if (!this.caseNumber.trim()) {
      this.error = 'Case number is required.';
      return;
    }

    if (!this.division.trim()) {
      this.error = 'Division is required.';
      return;
    }

    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;

    const reqBase = {
      caseNumber: this.caseNumber.trim(),
      division: this.division.trim(),
      circuitId: this.circuitId,
      countyId: this.countyId,
      numChildren: this.numChildren ?? undefined,
      petitionerId: this.petitionerId || undefined,
      respondentId: this.respondentId || undefined,
      petitionerAttId: this.petitionerAttId || undefined,
      respondentAttId: this.respondentAttId || undefined,
      legalAssistantId: this.legalAssistantId || undefined
    };

    const save$ = (
      this.editingCaseId
        ? from(
            this.casesApi.update(this.editingCaseId, {
              ...reqBase,
              // Preserve explicit null ("not specified") so server can unset the field.
              childSupportWorksheetFiled: this.childSupportWorksheetFiled
            })
          )
        : from(
            this.casesApi.create({
              ...reqBase,
              // Create payload only allows boolean|undefined.
              childSupportWorksheetFiled: this.childSupportWorksheetFiled ?? undefined
            })
          )
    ) as Observable<unknown>;

    this.subscription = save$
      .pipe(
        switchMap(() => {
          this.resetForm();
          return this.loadAll(this.casesView === 'archived');
        }),
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: ({ users, cases, circuits, counties, divisions }) => {
          this.users = users;
          this.applyUserTypeFilters();
          this.cases = cases;
          this.circuits = circuits;
          this.allCounties = counties;
          this.divisions = divisions;

          if (this.circuitId == null && this.circuits.length > 0) {
            this.circuitId = this.circuits[0]!.id;
          }
          if (!this.division && this.divisions.length > 0) {
            this.division = this.divisions[0]!.name;
          }
          this.applyCountyFilter();
          this.clampCasesPageIndex();
        },
        error: (e: any) => {
          const raw = e?.error?.error;
          this.error =
            raw === 'Invalid payload'
              ? 'Please fill out all required fields (Circuit, County, Case number, Division).'
              : (raw ?? 'Failed to create case');
        }
      });
  }

  setCasesView(view: 'active' | 'archived') {
    this.casesView = view;
    this.casesPageIndex = 0;
    this.refresh();
  }

  requestArchiveCase(c: CaseListItem) {
    this.caseToArchive = c;
    this.showArchiveConfirm = true;
  }

  confirmArchiveCase() {
    const c = this.caseToArchive;
    this.showArchiveConfirm = false;
    this.caseToArchive = null;
    if (!c || !this.canCreate) return;
    this.archiveRestoreBusy = true;
    this.error = null;
    this.casesApi
      .archive(c.id)
      .then(() => {
        this.success = `Case ${c.caseNumber} has been archived.`;
        this.refresh();
      })
      .catch((e: { error?: { error?: string } }) => {
        this.error = e?.error?.error ?? 'Failed to archive case.';
      })
      .finally(() => {
        this.archiveRestoreBusy = false;
      });
  }

  cancelArchiveCase() {
    this.showArchiveConfirm = false;
    this.caseToArchive = null;
  }

  requestRestoreCase(c: CaseListItem) {
    this.caseToRestore = c;
    this.showRestoreConfirm = true;
  }

  confirmRestoreCase() {
    const c = this.caseToRestore;
    this.showRestoreConfirm = false;
    this.caseToRestore = null;
    if (!c || !this.canCreate) return;
    this.archiveRestoreBusy = true;
    this.error = null;
    this.casesApi
      .restore(c.id)
      .then(() => {
        this.success = `Case ${c.caseNumber} has been restored.`;
        if (this.editingCaseId === c.id) {
          this.editingCaseId = null;
          this.editingCaseArchivedAt = null;
        }
        this.refresh();
      })
      .catch((e: { error?: { error?: string } }) => {
        this.error = e?.error?.error ?? 'Failed to restore case.';
      })
      .finally(() => {
        this.archiveRestoreBusy = false;
      });
  }

  cancelRestoreCase() {
    this.showRestoreConfirm = false;
    this.caseToRestore = null;
  }

  /** Restore the case currently being edited (when form shows archived banner). */
  requestRestoreCaseBeingEdited() {
    if (!this.editingCaseId) return;
    const c = this.cases.find((x) => x.id === this.editingCaseId) ?? { id: this.editingCaseId, caseNumber: this.caseNumber, division: '' };
    this.caseToRestore = c as CaseListItem;
    this.showRestoreConfirm = true;
  }

  formatArchivedAt(archivedAt?: string | null): string {
    if (!archivedAt) return '';
    try {
      const d = new Date(archivedAt);
      return d.toLocaleDateString(undefined, { dateStyle: 'short' });
    } catch {
      return archivedAt;
    }
  }

  editCase(caseId: string) {
    if (!this.canCreate) {
      this.error = 'Forbidden';
      return;
    }

    this.subscription?.unsubscribe();
    this.busy = true;
    this.error = null;

    this.subscription = from(this.casesApi.get(caseId))
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (c) => {
          this.editingCaseId = c.id;
          this.editingCaseArchivedAt = c.archivedAt ?? null;
          this.caseNumber = c.caseNumber ?? '';
          this.division = c.division ?? '';
          this.circuitId = c.circuitId ?? null;
          this.numChildren = c.numChildren ?? null;
          this.childSupportWorksheetFiled = c.childSupportWorksheetFiled ?? null;

          this.applyCountyFilter();
          if (typeof c.countyId === 'number' && this.counties.some((x) => x.id === c.countyId)) {
            this.countyId = c.countyId;
          }

          this.petitionerId = c.petitionerId ?? '';
          this.respondentId = c.respondentId ?? '';
          this.petitionerAttId = c.petitionerAttId ?? '';
          this.respondentAttId = c.respondentAttId ?? '';
          this.legalAssistantId = c.legalAssistantId ?? '';
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to load case';
        }
      });
  }

}
