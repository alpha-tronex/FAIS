import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-reset-page',
  templateUrl: './reset.page.html',
  styleUrl: './reset.page.css'
})
export class ResetPage {
  newPassword = '';
  showNewPassword = false;
  busy = false;
  error: string | null = null;

  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  async onSubmit() {
    this.busy = true;
    this.error = null;
    try {
      const wasOnboarding = this.auth.mustCompleteRegistration();
      await this.auth.changePassword(this.newPassword);
      if (wasOnboarding) {
        await this.router.navigateByUrl('/register');
      } else {
        await this.router.navigateByUrl(this.auth.isAdmin() ? '/admin' : '/my-cases');
      }
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Failed to change password';
    } finally {
      this.busy = false;
    }
  }
}
