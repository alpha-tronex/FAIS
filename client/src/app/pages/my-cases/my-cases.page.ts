import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { CasesService, CaseListItem } from '../../services/cases.service';

@Component({
  standalone: false,
  selector: 'app-my-cases-page',
  templateUrl: './my-cases.page.html',
  styleUrl: './my-cases.page.css'
})
export class MyCasesPage implements OnInit, OnDestroy {
  cases: CaseListItem[] = [];

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

  selectCase(caseId: string) {
    void this.router.navigate(['/affidavit/edit'], { queryParams: { caseId } });
  }

  viewSummary(caseId: string) {
    void this.router.navigate(['/affidavit'], { queryParams: { caseId } });
  }
}
