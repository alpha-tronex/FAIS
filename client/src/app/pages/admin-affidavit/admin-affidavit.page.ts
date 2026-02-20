import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AffidavitService } from '../../services/affidavit.service';
import { CasesService, CaseListItem } from '../../services/cases.service';
import { FileSaveService } from '../../services/file-save.service';
import { UsersService, UserListItem } from '../../services/users.service';

@Component({
  standalone: false,
  selector: 'app-admin-affidavit-page',
  templateUrl: './admin-affidavit.page.html',
  styleUrl: './admin-affidavit.page.css'
})
export class AdminAffidavitPage implements OnInit, OnDestroy {
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
    private readonly affidavitApi: AffidavitService,
    private readonly casesApi: CasesService,
    private readonly fileSave: FileSaveService,
    private readonly router: Router
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

  refresh() {
    this.busy = true;
    this.error = null;

    this.subscription?.unsubscribe();
    this.subscription = this.usersApi
      .list()
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (users) => {
          this.users = users.filter((u) => u.roleTypeId === 1);
          if (!this.selectedUserId && this.users.length > 0) {
            this.selectedUserId = this.users[0]!.id;
          } else if (this.selectedUserId && !this.users.some((u) => u.id === this.selectedUserId)) {
            this.selectedUserId = this.users[0]?.id ?? null;
          }
          this.selectedCaseId = null;
          void this.loadCasesForSelectedUser();
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to load users';
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  setSelectedUserId(userId: string | null) {
    this.selectedUserId = userId;
    this.selectedCaseId = null;
    void this.loadCasesForSelectedUser();
  }

  async loadCasesForSelectedUser() {
    this.cases = [];
    if (!this.selectedUserId) {
      return;
    }

    this.casesBusy = true;
    this.error = null;

    try {
      this.cases = await this.casesApi.list(this.selectedUserId);
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to load cases';
      if (e?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.casesBusy = false;
    }
  }

  selectCase(caseId: string) {
    this.selectedCaseId = caseId;
  }

  clearCaseSelection() {
    this.selectedCaseId = null;
  }

  private sanitizeFilenamePart(value: string): string {
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^a-zA-Z0-9._ -]+/g, '_')
      .replace(/_+/g, '_')
      .trim();
  }

  private buildDownloadFilename(): string {
    const user = this.users.find((u) => u.id === this.selectedUserId);
    const caseRow = this.cases.find((c) => c.id === this.selectedCaseId);

    const userPart = this.sanitizeFilenamePart(user?.uname || this.selectedUserId || 'user');
    const caseNumberPart = this.sanitizeFilenamePart(caseRow?.caseNumber || this.selectedCaseId || 'case');
    const divisionPart = this.sanitizeFilenamePart(caseRow?.division || '');

    const parts = ['financial-affidavit', userPart, caseNumberPart];
    if (divisionPart) parts.push(divisionPart);

    // Keep it reasonably short for filesystem compatibility.
    const base = parts.filter(Boolean).join('-').slice(0, 180);
    return `${base}.pdf`;
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
    const email = u.email ? ` (${u.email})` : '';
    return `${u.uname}${email}`;
  }

  async generatePdf() {
    if (!this.selectedUserId) return;
    if (!this.selectedCaseId) return;
    if (this.pdfBusy) return;

    this.pdfBusy = true;
    this.error = null;

    try {
      const blob = await this.affidavitApi.generateOfficialPdf('auto', this.selectedUserId, this.selectedCaseId);
      await this.fileSave.savePdf(blob, this.buildDownloadFilename());
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to generate PDF';
      if (e?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.pdfBusy = false;
    }
  }
}
