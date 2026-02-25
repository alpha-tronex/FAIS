import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-forgot-password-page',
  templateUrl: './forgot-password.page.html',
  styleUrl: './forgot-password.page.css'
})
export class ForgotPasswordPage {
  email = '';
  busy = false;
  error: string | null = null;
  success = false;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  async onSubmit() {
    const e = this.email.trim();
    if (!e) {
      this.error = 'Please enter your email address.';
      return;
    }
    const emailSimple = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailSimple.test(e)) {
      this.error = 'Please enter a valid email address.';
      return;
    }

    this.busy = true;
    this.error = null;
    this.success = false;

    try {
      await this.auth.forgotPassword(e);
      this.success = true;
    } catch (err: any) {
      this.error = err?.error?.error ?? 'Something went wrong. Please try again.';
    } finally {
      this.busy = false;
    }
  }
}
