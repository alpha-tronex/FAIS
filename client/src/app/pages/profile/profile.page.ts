import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService, type MeResponse, type UpdateMeRequest } from '../../services/auth.service';
import { LookupsService, LookupItem } from '../../services/lookups.service';
import { RoleTypesService, type RoleTypeItem } from '../../services/user-types.service';
import { UsersService } from '../../services/users.service';
import { SSN_REGEX } from '../../validation/registration.validation';

@Component({
  standalone: false,
  selector: 'app-profile-page',
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.css'
})
export class ProfilePage implements OnInit {
  busy = false;
  error: string | null = null;
  profileSaved = false;

  uname = '';
  email = '';
  firstName = '';
  lastName = '';
  addressLine1 = '';
  addressLine2 = '';
  city = '';
  state = '';
  zipCode = '';
  phone = '';

  roleTypeId = 1;
  roleTypes: RoleTypeItem[] = [];

  ssnLast4 = '';
  ssnFull: string | null = null;
  showSsn = false;

  newSsn = '';
  confirmNewSsn = '';
  showNewSsn = false;
  showConfirmNewSsn = false;

  states: LookupItem[] = [];

  editingUserId: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly lookups: LookupsService,
    private readonly roleTypesApi: RoleTypesService,
    private readonly usersApi: UsersService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) {
  }

  ngOnInit(): void {
		const id = this.route.snapshot.paramMap.get('id');
		this.editingUserId = id && this.auth.isAdmin() ? id : null;
    void this.init();
  }

  private async init() {
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      await this.loadStates();
      if (this.editingUserId) {
        await this.loadRoleTypes();
      }
			const me = this.editingUserId
				? await firstValueFrom(this.usersApi.get(this.editingUserId))
				: await this.auth.me();
			this.applyMe(me as unknown as MeResponse);
      this.cdr.markForCheck();
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to load profile';
      this.cdr.markForCheck();
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  private async loadStates() {
    try {
      this.states = await this.lookups.list('states');
    } catch {
      this.states = [];
    } finally {
      this.cdr.markForCheck();
    }
  }

  private async loadRoleTypes() {
    try {
      this.roleTypes = await this.roleTypesApi.list();
    } catch {
      this.roleTypes = [];
    } finally {
      this.cdr.markForCheck();
    }
  }

  private applyMe(me: MeResponse) {
    this.uname = me.uname ?? '';
    this.email = me.email ?? '';
    this.firstName = me.firstName ?? '';
    this.lastName = me.lastName ?? '';
    this.addressLine1 = me.addressLine1 ?? '';
    this.addressLine2 = me.addressLine2 ?? '';
    this.city = me.city ?? '';
    this.state = me.state ?? (this.states[0]?.abbrev ?? this.states[0]?.name ?? '');
    this.zipCode = me.zipCode ?? '';
    this.phone = me.phone ?? '';

    this.roleTypeId = Number(me.roleTypeId ?? 1) || 1;
    if (this.editingUserId && this.roleTypes.length > 0) {
      // Ensure the current role is present; fall back to first known role.
      if (!this.roleTypes.some((rt) => rt.id === this.roleTypeId)) {
        this.roleTypeId = this.roleTypes[0]!.id;
      }
    }

    this.ssnLast4 = me.ssnLast4 ?? '';
    this.ssnFull = null;
    this.showSsn = false;

    this.newSsn = '';
    this.confirmNewSsn = '';
    this.showNewSsn = false;
    this.showConfirmNewSsn = false;

    this.cdr.markForCheck();
  }

  get maskedSsn(): string {
    if (!this.ssnLast4) return '';
    return `***-**-${this.ssnLast4}`;
  }

  async toggleSsn() {
    this.error = null;
    this.profileSaved = false;
    this.cdr.markForCheck();

    if (this.showSsn) {
      this.showSsn = false;
      this.cdr.markForCheck();
      return;
    }

    this.showSsn = true;
    this.cdr.markForCheck();
    if (this.ssnFull) return;

    this.busy = true;
    this.cdr.markForCheck();
    try {
				const res = this.editingUserId
					? await firstValueFrom(this.usersApi.getSsn(this.editingUserId))
					: await this.auth.mySsn();
      this.ssnFull = res.ssn;
      if (res.ssnLast4) this.ssnLast4 = res.ssnLast4;
      this.cdr.markForCheck();
    } catch (e: any) {
      this.showSsn = false;
      this.error = e?.error?.error ?? 'Failed to load SSN';
      this.cdr.markForCheck();
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  async onSubmit() {
    this.busy = true;
    this.error = null;
    this.profileSaved = false;
    this.cdr.markForCheck();
    try {
      const meReq: UpdateMeRequest = {
        email: this.email.trim(),
        firstName: this.firstName.trim() || undefined,
        lastName: this.lastName.trim() || undefined,
        addressLine1: this.addressLine1.trim(),
        addressLine2: this.addressLine2.trim() || undefined,
        city: this.city.trim(),
        state: this.state.trim(),
        zipCode: this.zipCode.trim(),
        phone: this.phone.trim()
      };

      const updated = this.editingUserId
				? await firstValueFrom(
						this.usersApi.update(this.editingUserId, {
							...meReq,
							roleTypeId: Number(this.roleTypeId) || undefined
						})
					)
				: await this.auth.updateMe(meReq);
			this.applyMe(updated as unknown as MeResponse);
      this.profileSaved = true;
      this.cdr.markForCheck();
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to save profile';
      this.cdr.markForCheck();
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async updateSsn() {
    this.busy = true;
    this.error = null;
    this.profileSaved = false;
    this.cdr.markForCheck();
    try {
      const ssn = this.newSsn.trim();
      const confirmSsn = this.confirmNewSsn.trim();

      if (!ssn || !confirmSsn) {
        this.error = 'SSN and confirm SSN are required';
        return;
      }
      if (!SSN_REGEX.test(ssn)) {
        this.error = 'Social security format is invalid';
        return;
      }
      if (!SSN_REGEX.test(confirmSsn)) {
        this.error = 'Confirm social security format is invalid';
        return;
      }
      if (ssn !== confirmSsn) {
        this.error = 'Social security numbers do not match';
        return;
      }

      const updated = this.editingUserId
				? await firstValueFrom(this.usersApi.updateSsn(this.editingUserId, { ssn, confirmSsn }))
				: await this.auth.updateMySsn({ ssn, confirmSsn });
			this.applyMe(updated as unknown as MeResponse);
      this.cdr.markForCheck();
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to update SSN';
      this.cdr.markForCheck();
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
