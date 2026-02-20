import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize, switchMap } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { RoleTypesService, type RoleTypeItem } from '../../services/user-types.service';
import { UsersService, type UpdateUserRequest, UserListItem } from '../../services/users.service';

@Component({
  standalone: false,
  selector: 'app-users-page',
  templateUrl: './users.page.html',
  styleUrl: './users.page.css'
})
export class UsersPage implements OnInit, OnDestroy {
  users: UserListItem[] = [];
  roleTypes: RoleTypeItem[] = [];
  busy = false;
  error: string | null = null;
  success: string | null = null;

  canCreate = false;

  uname = '';
  email = '';
  password = '';
  showPassword = false;
  firstName = '';
  lastName = '';

  editingUserId: string | null = null;

  showCancelConfirm = false;
  subscription: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly roleTypesApi: RoleTypesService,
    private readonly usersApi: UsersService,
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

  refresh() {
    this.busy = true;
    this.error = null;
    this.success = null;

    void this.roleTypesApi
      .list()
      .then((items) => {
        this.roleTypes = items;
      })
      .catch(() => {
        // role types are used for display only; keep page usable if unavailable
      });

    this.subscription = this.usersApi
      .list()
      .pipe(
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (users) => {
          this.users = users;
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

  roleTypeName(roleTypeId: number): string {
    return this.roleTypes.find((rt) => rt.id === roleTypeId)?.name ?? String(roleTypeId);
  }

  create() {
    if (!this.canCreate) {
      this.error = 'Forbidden';
      this.success = null;
      return;
    }

    if (this.editingUserId) {
      this.update();
      return;
    }

    this.busy = true;
    this.error = null;
    this.success = null;

    const req = {
      uname: this.uname.trim(),
      email: this.email.trim(),
      password: this.password,
      firstName: this.firstName.trim() || undefined,
      lastName: this.lastName.trim() || undefined
    };

    this.subscription = this.usersApi
      .create(req)
      .pipe(
        switchMap((res) => {
          this.success = 'User created.';
          this.uname = '';
          this.email = '';
          this.password = '';
          this.showPassword = false;
          this.firstName = '';
          this.lastName = '';
          return this.usersApi.list();
        }),
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (users) => {
          this.users = users;
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to create user';
          this.success = null;
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  editUser(u: UserListItem) {
    if (!this.canCreate) return;
    void this.router.navigate(['/admin/users', u.id, 'profile']);
  }

  requestCancelEdit(): void {
    this.showCancelConfirm = true;
  }

  cancelEdit(): void {
    this.showCancelConfirm = false;
    this.editingUserId = null;
    this.error = null;
    this.success = null;

    this.uname = '';
    this.email = '';
    this.password = '';
    this.showPassword = false;
    this.firstName = '';
    this.lastName = '';
  }

  private update() {
    if (!this.editingUserId) return;

    this.busy = true;
    this.error = null;
    this.success = null;

    const req: UpdateUserRequest = {
      email: this.email.trim() || undefined,
      firstName: this.firstName.trim() || undefined,
      lastName: this.lastName.trim() || undefined,
      roleTypeId: undefined
    };

    this.subscription = this.usersApi
      .update(this.editingUserId, req)
      .pipe(
        switchMap(() => {
          this.success = 'User saved.';
          this.editingUserId = null;
          this.uname = '';
          this.email = '';
          this.firstName = '';
          this.lastName = '';
          return this.usersApi.list();
        }),
        finalize(() => {
          this.busy = false;
        })
      )
      .subscribe({
        next: (users) => {
          this.users = users;
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Failed to update user';
          this.success = null;
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }
}
