import { ChangeDetectorRef, Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LookupsService, LookupItem } from '../../services/lookups.service';
import { validateRegistration } from '../../validation/registration.validation';

@Component({
  standalone: false,
  selector: 'app-register-page',
  templateUrl: './register.page.html',
  styleUrl: './register.page.css'
})
export class RegisterPage {
  finishMode = false;

  uname = '';
  email = '';
  password = '';
  confirmPassword = '';

  firstName = '';
  lastName = '';

  addressLine1 = '';
  addressLine2 = '';
  city = '';
  state = '';
  zipCode = '';
  phone = '';
  ssn = '';
  confirmSsn = '';

  showPassword = false;
  showConfirmPassword = false;
  showSsn = false;
  showConfirmSsn = false;

  states: LookupItem[] = [];

  busy = false;
  error: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly lookups: LookupsService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.finishMode = this.auth.mustCompleteRegistration();
    if (this.finishMode) {
      this.uname = this.auth.getUnameFromToken() ?? '';
      void this.prefillFromMe();
    }
    void this.loadStates();
  }

  private async prefillFromMe() {
    try {
      const me = await this.auth.me();
      this.uname = me.uname ?? this.uname;
      this.email = me.email ?? this.email;
      this.firstName = me.firstName ?? this.firstName;
      this.lastName = me.lastName ?? this.lastName;
      this.addressLine1 = me.addressLine1 ?? this.addressLine1;
      this.addressLine2 = me.addressLine2 ?? this.addressLine2;
      this.city = me.city ?? this.city;
      this.state = me.state ?? this.state;
      this.zipCode = me.zipCode ?? this.zipCode;
      this.phone = me.phone ?? this.phone;
    } catch {
      // keep page usable even if /me fails
    } finally {
      this.cdr.markForCheck();
    }
  }

  private async loadStates() {
    try {
      this.states = await this.lookups.list('states');
      if (!this.state && this.states.length > 0) {
        this.state = this.states[0]!.abbrev ?? this.states[0]!.name;
      }
    } catch {
      // keep registration usable even if lookups are unavailable
      this.states = [];
    } finally {
      this.cdr.markForCheck();
    }
  }

  async onSubmit() {
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      const errors = validateRegistration({
        uname: this.uname,
        email: this.email,
        password: this.password,
        confirmPassword: this.confirmPassword,
        firstName: this.firstName,
        lastName: this.lastName,
        addressLine1: this.addressLine1,
        addressLine2: this.addressLine2,
        city: this.city,
        state: this.state,
        zipCode: this.zipCode,
        phone: this.phone,
        ssn: this.ssn,
        confirmSsn: this.confirmSsn
      });
      if (errors.length > 0) {
        this.error = errors[0] ?? 'Invalid registration';
        this.cdr.markForCheck();
        return;
      }

      if (this.finishMode) {
        await this.auth.updateMe({
          email: this.email.trim() || undefined,
          firstName: this.firstName.trim() || undefined,
          lastName: this.lastName.trim() || undefined,
          addressLine1: this.addressLine1.trim() || undefined,
          addressLine2: this.addressLine2.trim() || undefined,
          city: this.city.trim() || undefined,
          state: this.state.trim() || undefined,
          zipCode: this.zipCode.trim() || undefined,
          phone: this.phone.trim() || undefined
        });

        await this.auth.updateMySsn({ ssn: this.ssn.trim(), confirmSsn: this.confirmSsn.trim() });
        await this.auth.changePassword(this.password);

        await this.router.navigateByUrl(this.auth.isAdmin() ? '/admin' : '/my-cases');
        return;
      }

      const res = await this.auth.register({
        uname: this.uname.trim(),
        email: this.email.trim(),
        password: this.password,
        firstName: this.firstName.trim() || undefined,
        lastName: this.lastName.trim() || undefined,
        addressLine1: this.addressLine1.trim(),
        addressLine2: this.addressLine2.trim() || undefined,
        city: this.city.trim(),
        state: this.state.trim(),
        zipCode: this.zipCode.trim(),
        phone: this.phone.trim(),
        ssn: this.ssn.trim()
      });
      if (res.mustResetPassword) {
        await this.router.navigateByUrl('/register');
      } else if (res.user?.roleTypeId === 5) {
        await this.router.navigateByUrl('/admin');
      } else {
        await this.router.navigateByUrl('/my-cases');
      }
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Registration failed';
      this.cdr.markForCheck();
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
