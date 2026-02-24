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

  editingCaseId: string | null = null;

  busy = false;
  error: string | null = null;

  canCreate = false;

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

  private applyUserTypeFilters() {
    // Create-case dropdowns are filtered by the simplified RoleType IDs.
    // 1 Petitioner, 2 Respondent, 3 Petitioner Attorney, 4 Respondent Attorney, 5 Administrator
    const petitioners = this.users.filter((u) => u.roleTypeId === 1);
    const respondents = this.users.filter((u) => u.roleTypeId === 2);
    const petitionerAttorneys = this.users.filter((u) => u.roleTypeId === 3);
    const respondentAttorneys = this.users.filter((u) => u.roleTypeId === 4);

    this.petitioners = petitioners;
    this.respondents = respondents;
    this.petitionerAttorneys = petitionerAttorneys;
    this.respondentAttorneys = respondentAttorneys;

    // Keep selections if still valid; otherwise clear.
    if (this.petitionerId && !this.petitioners.some((u) => u.id === this.petitionerId)) this.petitionerId = '';
    if (this.respondentId && !this.respondents.some((u) => u.id === this.respondentId)) this.respondentId = '';
    if (this.petitionerAttId && !this.petitionerAttorneys.some((u) => u.id === this.petitionerAttId)) this.petitionerAttId = '';
    if (this.respondentAttId && !this.respondentAttorneys.some((u) => u.id === this.respondentAttId)) this.respondentAttId = '';
  }

  private loadAll() {

      console.log('this.cases', this.cases);

    return forkJoin({
      users: from(this.usersApi.list()),
      cases: from(this.casesApi.list()),
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
    this.editingCaseId = null;

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

    this.subscription = this.loadAll()
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

    const req = {
      caseNumber: this.caseNumber.trim(),
      division: this.division.trim(),
      circuitId: this.circuitId,
      countyId: this.countyId,
      numChildren: this.numChildren ?? undefined,
      childSupportWorksheetFiled: this.childSupportWorksheetFiled ?? undefined,
      petitionerId: this.petitionerId || undefined,
      respondentId: this.respondentId || undefined,
      petitionerAttId: this.petitionerAttId || undefined,
      respondentAttId: this.respondentAttId || undefined
    };

    const save$ = (
      this.editingCaseId
        ? from(this.casesApi.update(this.editingCaseId, req))
        : from(this.casesApi.create(req))
    ) as Observable<unknown>;

    this.subscription = save$
      .pipe(
        switchMap(() => {
          this.resetForm();
          return this.loadAll();
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
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to load case';
        }
      });
  }

}
