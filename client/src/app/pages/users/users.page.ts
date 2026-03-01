import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize, from, switchMap } from 'rxjs';
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
  roleTypeId = 1;

  /** Role types that can be assigned when creating a user (excludes Administrator). */
  get createableRoleTypes(): RoleTypeItem[] {
    return this.roleTypes.filter((rt) => rt.id !== 5);
  }

  editingUserId: string | null = null;

  showCancelConfirm = false;
  /** When true, show "Send invitation email?" confirm popup before creating user. */
  showSendEmailConfirm = false;
  subscription: Subscription | null = null;

  /** Create minimal user by ask */
  askPrompt = '';
  askBusy = false;
  askError: string | null = null;
  showMinimalUserSuccessPopup = false;
  /** Message for the success popup (e.g. "Jim Kelly was created as respondent.") */
  minimalUserSuccessMessage = '';
  /** Id of the user just created via ask, for undo. */
  createdUserIdForUndo: string | null = null;

  /** Table sort: column key and direction. */
  sortBy: 'name' | 'uname' | 'email' | 'role' = 'name';
  sortDir: 'asc' | 'desc' = 'asc';
  /** Filter by role type; null = show all. */
  roleFilter: number | null = null;

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
        const createable = items.filter((rt) => rt.id !== 5);
        if (createable.length > 0 && !createable.some((rt) => rt.id === this.roleTypeId)) {
          this.roleTypeId = createable[0].id;
        }
      })
      .catch(() => {
        // role types are used for display only; keep page usable if unavailable
      });

    this.subscription = from(this.usersApi.list())
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

  /** Users filtered by roleFilter and sorted by sortBy/sortDir. */
  get filteredUsers(): UserListItem[] {
    let list = this.roleFilter != null ? this.users.filter((u) => u.roleTypeId === this.roleFilter!) : this.users;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (this.sortBy) {
        case 'name':
          const na = `${(a.lastName ?? '').toLowerCase()}, ${(a.firstName ?? '').toLowerCase()}`;
          const nb = `${(b.lastName ?? '').toLowerCase()}, ${(b.firstName ?? '').toLowerCase()}`;
          cmp = na.localeCompare(nb);
          break;
        case 'uname':
          cmp = (a.uname ?? '').toLowerCase().localeCompare((b.uname ?? '').toLowerCase());
          break;
        case 'email':
          cmp = (a.email ?? '').toLowerCase().localeCompare((b.email ?? '').toLowerCase());
          break;
        case 'role':
          cmp = a.roleTypeId - b.roleTypeId;
          if (cmp === 0) {
            const ra = this.roleTypeName(a.roleTypeId).toLowerCase();
            const rb = this.roleTypeName(b.roleTypeId).toLowerCase();
            cmp = ra.localeCompare(rb);
          }
          break;
        default:
          break;
      }
      return cmp * dir;
    });
    return list;
  }

  setSort(column: 'name' | 'uname' | 'email' | 'role') {
    if (this.sortBy === column) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = column;
      this.sortDir = 'asc';
    }
  }

  submitAskCreateUser(): void {
    if (this.askBusy || !this.askPrompt.trim()) return;
    this.askBusy = true;
    this.askError = null;
    this.error = null;
    this.usersApi
      .createFromPrompt(this.askPrompt.trim())
      .then((res) => {
        const name = [res.firstName, res.lastName].filter(Boolean).join(' ') || 'User';
        const roleName = res.roleTypeId === 4 ? 'respondent attorney' : 'respondent';
        this.minimalUserSuccessMessage = `${name} was created as ${roleName}. You can complete their profile from the list below.`;
        this.createdUserIdForUndo = res.id;
        this.showMinimalUserSuccessPopup = true;
        this.askPrompt = '';
        this.refresh();
      })
      .catch((e: { error?: { error?: string }; status?: number }) => {
        if (e?.status === 401) {
          this.auth.logout();
          void this.router.navigateByUrl('/login');
          return;
        }
        if (e?.status === 503) {
          this.askError = 'AI create-from-prompt is not configured. Please contact support.';
          return;
        }
        if (e?.status === 429 || e?.status === 402) {
          this.askError = 'AI quota exceeded. Please try again later.';
          return;
        }
        this.askError = e?.error?.error ?? 'Failed to create user from prompt.';
      })
      .finally(() => {
        this.askBusy = false;
      });
  }

  onUndoMinimalUser(): void {
    const id = this.createdUserIdForUndo;
    this.showMinimalUserSuccessPopup = false;
    this.createdUserIdForUndo = null;
    if (!id) return;
    this.busy = true;
    this.usersApi
      .delete(id)
      .then(() => {
        this.success = 'User removed.';
        this.refresh();
      })
      .catch((e: { error?: { error?: string } }) => {
        this.error = e?.error?.error ?? 'Failed to remove user.';
      })
      .finally(() => {
        this.busy = false;
      });
  }

  onDismissMinimalUserSuccess(): void {
    this.showMinimalUserSuccessPopup = false;
    this.createdUserIdForUndo = null;
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

    this.error = null;
    const validationError = this.validateCreateForm();
    if (validationError) {
      this.error = validationError;
      return;
    }

    const isMinimal = this.isMinimalCreate();
    if (isMinimal) {
      this.createMinimalUser();
      return;
    }

    this.showSendEmailConfirm = true;
  }

  /** True when role is 2 or 4 and username, email, password are not all filled (minimal create, no invite). */
  private isMinimalCreate(): boolean {
    const role = Number(this.roleTypeId);
    if (role !== 2 && role !== 4) return false;
    const u = this.uname.trim();
    const e = this.email.trim();
    const p = this.password;
    return !u && !e && !p;
  }

  /** Returns an error message if create form is invalid, otherwise null. */
  private validateCreateForm(): string | null {
    const first = this.firstName.trim();
    const last = this.lastName.trim();
    const role = Number(this.roleTypeId) || 0;
    if (!first) return 'First name is required.';
    if (!last) return 'Last name is required.';
    if (!this.createableRoleTypes.some((rt) => rt.id === role)) return 'Please select a role.';

    const u = this.uname.trim();
    const e = this.email.trim();
    const p = this.password;
    const hasAnyCredential = !!u || !!e || !!p;

    if (hasAnyCredential) {
      if (!u) return 'Username is required when providing email or password.';
      if (!e) return 'Email is required when providing username or password.';
      const emailSimple = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailSimple.test(e)) return 'Please enter a valid email address.';
      if (!p) return 'Password is required when providing username or email.';
      if (p.length < 8) return 'Password must be at least 8 characters.';
    } else if (role !== 2 && role !== 4) {
      return 'For petitioner or petitioner attorney, please enter username, email, and password so the user can log in.';
    }

    return null;
  }

  private createMinimalUser(): void {
    this.busy = true;
    this.error = null;
    this.success = null;

    const req = {
      firstName: this.firstName.trim(),
      lastName: this.lastName.trim(),
      roleTypeId: Number(this.roleTypeId)
    };

    this.subscription = from(this.usersApi.create(req))
      .pipe(
        switchMap(() => {
          this.success = 'User created. Complete their profile to add details.';
          this.resetCreateForm();
          return from(this.usersApi.list());
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
          const msg = e?.error?.error;
          this.error = typeof msg === 'string' && msg.length > 0 ? msg : 'Failed to create user. Please check the form and try again.';
          this.success = null;
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  /** Called after admin chooses in the send-email popup. Creates user with or without invite email. */
  createUserWithInviteChoice(sendInviteEmail: boolean) {
    this.showSendEmailConfirm = false;

    this.busy = true;
    this.error = null;
    this.success = null;

    const req = {
      uname: this.uname.trim(),
      email: this.email.trim(),
      password: this.password,
      firstName: this.firstName.trim() || undefined,
      lastName: this.lastName.trim() || undefined,
      roleTypeId: Number(this.roleTypeId) || 1,
      sendInviteEmail
    };

    this.subscription = from(this.usersApi.create(req))
      .pipe(
        switchMap(() => {
          this.success = sendInviteEmail ? 'User created. Invitation email sent.' : 'User created.';
          this.resetCreateForm();
          return from(this.usersApi.list());
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
          const msg = e?.error?.error;
          this.error = typeof msg === 'string' && msg.length > 0 ? msg : 'Failed to create user. Please check the form and try again.';
          this.success = null;
          if (e?.status === 401) {
            this.auth.logout();
            void this.router.navigateByUrl('/login');
          }
        }
      });
  }

  private resetCreateForm(): void {
    this.uname = '';
    this.email = '';
    this.password = '';
    this.showPassword = false;
    this.firstName = '';
    this.lastName = '';
    this.roleTypeId = this.createableRoleTypes[0]?.id ?? 1;
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
    this.resetCreateForm();
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

    this.subscription = from(this.usersApi.update(this.editingUserId, req))
      .pipe(
        switchMap(() => {
          this.success = 'User saved.';
          this.editingUserId = null;
          this.uname = '';
          this.email = '';
          this.firstName = '';
          this.lastName = '';
          return from(this.usersApi.list());
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
