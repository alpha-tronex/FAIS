import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize, from } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ChildSupportWorksheetService } from '../../services/child-support-worksheet.service';
import { CasesService, CaseListItem } from '../../services/cases.service';
import { FileSaveService } from '../../services/file-save.service';
import { UsersService, UserListItem } from '../../services/users.service';

@Component({
  standalone: false,
  selector: 'app-admin-child-support-worksheet-page',
  templateUrl: './admin-child-support-worksheet.page.html',
  styleUrl: './admin-child-support-worksheet.page.css'
})
export class AdminChildSupportWorksheetPage implements OnInit, OnDestroy {
  users: UserListItem[] = [];
  selectedUserId: string | null = null;
  cases: CaseListItem[] = [];
  selectedCaseId: string | null = null;

  busy = false;
  casesBusy = false;
  pdfBusy = false;
  error: string | null = null;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly usersApi: UsersService,
    private readonly worksheetApi: ChildSupportWorksheetService,
    private readonly casesApi: CasesService,
    private readonly fileSave: FileSaveService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/login');
      return;
    }
    if (!this.auth.isAdmin()) {
      void this.router.navigateByUrl('/my-cases');
      return;
    }
    this.refresh();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  refresh(): void {
    this.busy = true;
    this.error = null;
    this.subscription?.unsubscribe();
    this.subscription = from(this.usersApi.list())
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (users) => {
          this.users = users.filter((u) => u.roleTypeId === 1);
          const qpUserId = this.route.snapshot.queryParamMap.get('userId');
          const qpCaseId = this.route.snapshot.queryParamMap.get('caseId');
          if (qpUserId && qpCaseId && this.users.some((u) => u.id === qpUserId)) {
            this.selectedUserId = qpUserId;
            this.selectedCaseId = qpCaseId;
          } else {
            if (!this.selectedUserId && this.users.length > 0) {
              this.selectedUserId = this.users[0]!.id;
            } else if (this.selectedUserId && !this.users.some((u) => u.id === this.selectedUserId)) {
              this.selectedUserId = this.users[0]?.id ?? null;
            }
            this.selectedCaseId = null;
          }
          void this.loadCasesForSelectedUser();
        },
        error: (e: unknown) => {
          const err = e as { error?: { error?: string }; status?: number };
          this.error = err?.error?.error ?? 'Failed to load users';
          if (err?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  setSelectedUserId(userId: string | null): void {
    this.selectedUserId = userId;
    this.selectedCaseId = null;
    void this.loadCasesForSelectedUser();
  }

  async loadCasesForSelectedUser(): Promise<void> {
    this.cases = [];
    if (!this.selectedUserId) return;
    this.casesBusy = true;
    this.error = null;
    try {
      this.cases = await this.casesApi.list(this.selectedUserId);
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; status?: number };
      this.error = err?.error?.error ?? 'Failed to load cases';
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.casesBusy = false;
    }
  }

  selectCase(caseId: string): void {
    this.selectedCaseId = caseId;
  }

  clearCaseSelection(): void {
    this.selectedCaseId = null;
  }

  worksheetQueryParams(): Record<string, string> {
    const q: Record<string, string> = {};
    if (this.selectedUserId) q['userId'] = this.selectedUserId;
    if (this.selectedCaseId) q['caseId'] = this.selectedCaseId;
    return q;
  }

  selectedCaseLabel(): string {
    if (!this.selectedCaseId) return '';
    const c = this.cases.find((x) => x.id === this.selectedCaseId);
    if (!c) return this.selectedCaseId;
    const div = c.division ? ` / ${c.division}` : '';
    return `${c.caseNumber}${div}`;
  }

  selectedUserLabel(): string {
    if (!this.selectedUserId) return '';
    const u = this.users.find((x) => x.id === this.selectedUserId);
    if (!u) return this.selectedUserId;
    return `${u.uname}${u.email ? ' (' + u.email + ')' : ''}`;
  }

  async generatePdf(): Promise<void> {
    if (!this.selectedUserId || !this.selectedCaseId || this.pdfBusy) return;
    this.pdfBusy = true;
    this.error = null;
    try {
      const blob = await this.worksheetApi.generatePdf(this.selectedUserId, this.selectedCaseId);
      await this.fileSave.savePdf(blob, 'child-support-guidelines-worksheet.pdf');
    } catch (e: unknown) {
      const err = e as { error?: { error?: string }; status?: number };
      this.error = err?.error?.error ?? 'Failed to generate PDF';
      if (err?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.pdfBusy = false;
    }
  }
}
