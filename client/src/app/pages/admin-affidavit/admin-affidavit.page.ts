import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AffidavitService } from '../../services/affidavit.service';
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

  busy = false;
  pdfBusy = false;
  error: string | null = null;

  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly usersApi: UsersService,
    private readonly affidavitApi: AffidavitService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
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
    this.cdr.markForCheck();

    this.subscription?.unsubscribe();
    this.subscription = this.usersApi
      .list()
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (users) => {
          this.users = users;
          if (!this.selectedUserId && users.length > 0) {
            this.selectedUserId = users[0]!.id;
          }
          this.cdr.markForCheck();
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to load users';
          this.cdr.markForCheck();
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  async generatePdf() {
    if (!this.selectedUserId) return;
    if (this.pdfBusy) return;

    this.pdfBusy = true;
    this.error = null;
    this.cdr.markForCheck();

    try {
      const blob = await this.affidavitApi.generatePdf('auto', this.selectedUserId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financial-affidavit-${this.selectedUserId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to generate PDF';
      if (e?.status === 401) {
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      }
    } finally {
      this.pdfBusy = false;
      this.cdr.markForCheck();
    }
  }
}
