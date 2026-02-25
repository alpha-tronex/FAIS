import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-reset-password-page',
  templateUrl: './reset-password.page.html',
  styleUrl: './reset-password.page.css'
})
export class ResetPasswordPage implements OnInit {
  token = '';
  newPassword = '';
  confirmPassword = '';
  showNewPassword = false;
  showConfirmPassword = false;
  busy = false;
  error: string | null = null;
  success = false;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token')?.trim() ?? '';
    if (!this.token) {
      this.error = 'Invalid or missing reset link. Please request a new password reset.';
    }
  }

  async onSubmit() {
    if (!this.token) return;

    const p = this.newPassword;
    const c = this.confirmPassword;
    if (!p || p.length < 8) {
      this.error = 'Password must be at least 8 characters.';
      return;
    }
    if (p !== c) {
      this.error = 'Passwords do not match.';
      return;
    }

    this.busy = true;
    this.error = null;

    try {
      await this.auth.resetPassword(this.token, p);
      this.success = true;
      setTimeout(() => {
        void this.router.navigate(['/login'], { queryParams: { reset: 'success' } });
      }, 2000);
    } catch (err: any) {
      this.error = err?.error?.error ?? 'Invalid or expired reset link. Please request a new password reset.';
    } finally {
      this.busy = false;
    }
  }
}
