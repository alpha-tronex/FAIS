import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { CasesService, CaseListItem } from '../../services/cases.service';

type CaseSortKey = 'caseNumber' | 'division' | 'petitioner' | 'respondent' | 'createdAt';

@Component({
  standalone: false,
  selector: 'app-my-cases-page',
  templateUrl: './my-cases.page.html',
  styleUrl: './my-cases.page.css'
})
export class MyCasesPage implements OnInit, OnDestroy {
  cases: CaseListItem[] = [];

  /** Attorneys and assistants: column sort (default newest cases first). */
  sortKey: CaseSortKey = 'createdAt';
  sortDir: 'asc' | 'desc' = 'desc';

  busy = false;
  error: string | null = null;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly casesApi: CasesService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    this.refresh();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  refresh() {
    this.subscription?.unsubscribe();

    this.busy = true;
    this.error = null;

    this.subscription = from(this.casesApi.list())
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (cases) => {
          this.cases = cases;
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

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  /** Respondent (2) or Respondent Attorney (4): view petitioner's affidavit only. */
  get isRespondentViewer(): boolean {
    return this.auth.hasRole(2, 4);
  }

  /**
   * Petitioner attorney (3) and legal assistant (6) use worksheet links on affidavit edit / summary;
   * row shortcut is for petitioners and other non-respondent roles.
   */
  get showWorksheetTableButton(): boolean {
    return !this.isRespondentViewer && !this.auth.hasRole(3, 6);
  }

  /** Petitioner attorney (3) and legal assistant (6): sortable case table headers. */
  get isCaseTableSortable(): boolean {
    return this.auth.hasRole(3, 6);
  }

  get sortedCases(): CaseListItem[] {
    if (!this.isCaseTableSortable) return this.cases;
    const rows = [...this.cases];
    const mul = this.sortDir === 'asc' ? 1 : -1;
    const key = this.sortKey;
    rows.sort((a, b) => mul * this.compareCases(a, b, key));
    return rows;
  }

  toggleSort(column: CaseSortKey): void {
    if (!this.isCaseTableSortable) return;
    if (this.sortKey === column) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = column;
      this.sortDir = column === 'createdAt' ? 'desc' : 'asc';
    }
  }

  ariaSortFor(column: CaseSortKey): 'ascending' | 'descending' | 'none' {
    if (!this.isCaseTableSortable || this.sortKey !== column) return 'none';
    return this.sortDir === 'asc' ? 'ascending' : 'descending';
  }

  private compareCases(a: CaseListItem, b: CaseListItem, key: CaseSortKey): number {
    switch (key) {
      case 'caseNumber':
        return (a.caseNumber || '').localeCompare(b.caseNumber || '', undefined, {
          numeric: true,
          sensitivity: 'base'
        });
      case 'division':
        return (a.division || '').localeCompare(b.division || '', undefined, { sensitivity: 'base' });
      case 'petitioner':
        return this.partySortLabel(a.petitioner).localeCompare(this.partySortLabel(b.petitioner), undefined, {
          sensitivity: 'base'
        });
      case 'respondent':
        return this.partySortLabel(a.respondent).localeCompare(this.partySortLabel(b.respondent), undefined, {
          sensitivity: 'base'
        });
      case 'createdAt': {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
      }
      default:
        return 0;
    }
  }

  private partySortLabel(p: CaseListItem['petitioner']): string {
    if (!p) return '';
    const name = [p.lastName || '', p.firstName || ''].join(' ').trim();
    return name || (p.uname || '');
  }

  selectCase(caseId: string) {
    void this.router.navigate(['/affidavit/edit'], { queryParams: { caseId } });
  }

  viewSummary(caseId: string) {
    void this.router.navigate(['/affidavit'], { queryParams: { caseId } });
  }

  openWorksheet(caseId: string) {
    void this.router.navigate(['/child-support-worksheet'], { queryParams: { caseId } });
  }
}
