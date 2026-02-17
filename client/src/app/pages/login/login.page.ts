import { ChangeDetectorRef, Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-login-page',
  templateUrl: './login.page.html',
  styleUrl: './login.page.css'
})
export class LoginPage {
  uname = '';
  password = '';
  showPassword = false;
  busy = false;
  error: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async onSubmit() {
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      const res = await this.auth.login(this.uname.trim(), this.password);
      if (res.mustResetPassword) {
        await this.router.navigateByUrl('/register');
      } else if (res.user?.roleTypeId === 5) {
        await this.router.navigateByUrl('/admin');
      } else {
        await this.router.navigateByUrl('/my-cases');
      }
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Login failed';
      this.cdr.markForCheck();
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
