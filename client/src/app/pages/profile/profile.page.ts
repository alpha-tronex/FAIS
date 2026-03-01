import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
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
  gender = '';
  dateOfBirth = '';
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
  caseId: string | null = null;

  passwordResetBusy = false;
  passwordResetSent = false;
  passwordResetError: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly lookups: LookupsService,
    private readonly roleTypesApi: RoleTypesService,
    private readonly usersApi: UsersService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
		const id = this.route.snapshot.paramMap.get('id');
		this.editingUserId = id && this.auth.isAdmin() ? id : null;

		const qpCaseId = this.route.snapshot.queryParamMap.get('caseId');
		if (qpCaseId) {
			this.caseId = qpCaseId;
		}
    void this.init();
  }

  navQueryParams(): Record<string, string> {
    const qp: Record<string, string> = {};
    if (this.caseId) qp['caseId'] = this.caseId;
    return qp;
  }

  private async init() {
    this.busy = true;
    this.error = null;
    try {
      await this.loadStates();
      if (this.editingUserId) {
        await this.loadRoleTypes();
      }
			const me = this.editingUserId
				? await this.usersApi.get(this.editingUserId)
				: await this.auth.me();
			this.applyMe(me as unknown as MeResponse);
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to load profile';
    } finally {
      this.busy = false;
    }
  }

  private async loadStates() {
    try {
      this.states = await this.lookups.list('states');
    } catch {
      this.states = [];
    }
  }

  private async loadRoleTypes() {
    try {
      this.roleTypes = await this.roleTypesApi.list();
    } catch {
      this.roleTypes = [];
    }
  }

  private applyMe(me: MeResponse) {
    this.uname = me.uname ?? '';
    this.email = me.email ?? '';
    this.firstName = me.firstName ?? '';
    this.lastName = me.lastName ?? '';
    this.gender = me.gender ?? '';
    this.dateOfBirth = me.dateOfBirth ?? '';
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
  }

  get maskedSsn(): string {
    if (!this.ssnLast4) return '';
    return `***-**-${this.ssnLast4}`;
  }

  async toggleSsn() {
    this.error = null;
    this.profileSaved = false;

    if (this.showSsn) {
      this.showSsn = false;
      return;
    }

    this.showSsn = true;
    if (this.ssnFull) return;

    this.busy = true;
    try {
				const res = this.editingUserId
					? await this.usersApi.getSsn(this.editingUserId)
					: await this.auth.mySsn();
      this.ssnFull = res.ssn;
      if (res.ssnLast4) this.ssnLast4 = res.ssnLast4;
    } catch (e: any) {
      this.showSsn = false;
      this.error = e?.error?.error ?? 'Failed to load SSN';
    } finally {
      this.busy = false;
    }
  }

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  async sendPasswordResetEmail() {
    if (!this.editingUserId) return;
    this.passwordResetBusy = true;
    this.passwordResetError = null;
    this.passwordResetSent = false;
    try {
      await this.usersApi.sendPasswordReset(this.editingUserId);
      this.passwordResetSent = true;
    } catch (e: any) {
      this.passwordResetError = e?.error?.error ?? 'Failed to send password reset email.';
    } finally {
      this.passwordResetBusy = false;
    }
  }

  async onSubmit() {
    this.busy = true;
    this.error = null;
    this.profileSaved = false;
    try {
      if (!this.email.trim()) {
        this.error = 'Email is required';
        return;
      }
      if (!this.addressLine1.trim()) {
        this.error = 'Address line 1 is required';
        return;
      }
      if (!this.city.trim()) {
        this.error = 'City is required';
        return;
      }
      if (!this.state.trim()) {
        this.error = 'State is required';
        return;
      }
      if (!this.zipCode.trim()) {
        this.error = 'Zip is required';
        return;
      }
      if (!this.phone.trim()) {
        this.error = 'Phone is required';
        return;
      }

      const meReq: UpdateMeRequest = {
        email: this.email.trim() || undefined,
        firstName: this.firstName.trim() || undefined,
        lastName: this.lastName.trim() || undefined,
        gender: this.gender.trim() || undefined,
        dateOfBirth: this.dateOfBirth.trim() || undefined,
        addressLine1: this.addressLine1.trim() || undefined,
        addressLine2: this.addressLine2.trim() || undefined,
        city: this.city.trim() || undefined,
        state: this.state.trim() || undefined,
        zipCode: this.zipCode.trim() || undefined,
        phone: this.phone.trim() || undefined
      };

      const updated = this.editingUserId
				? await this.usersApi.update(this.editingUserId, {
						...meReq,
						roleTypeId: Number(this.roleTypeId) || undefined
					})
				: await this.auth.updateMe(meReq);
			this.applyMe(updated as unknown as MeResponse);
      this.profileSaved = true;
    } catch (e: any) {
      const raw = e?.error?.error;
      this.error =
        raw === 'Invalid payload'
          ? 'Please fill out all required profile fields.'
          : (raw ?? 'Failed to save profile');
    } finally {
      this.busy = false;
    }
  }

  async updateSsn() {
    this.busy = true;
    this.error = null;
    this.profileSaved = false;
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
				? await this.usersApi.updateSsn(this.editingUserId, { ssn, confirmSsn })
				: await this.auth.updateMySsn({ ssn, confirmSsn });
			this.applyMe(updated as unknown as MeResponse);
    } catch (e: any) {
      const raw = e?.error?.error;
      this.error = raw === 'Invalid payload' ? 'Social security input is invalid.' : (raw ?? 'Failed to update SSN');
    } finally {
      this.busy = false;
    }
  }
}
