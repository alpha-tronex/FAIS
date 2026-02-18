import { Component } from '@angular/core';
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
    private readonly router: Router
  ) {}

  onSubmit() {
    if (this.busy) return;

    this.busy = true;
    this.error = null;

    this.auth.login$(this.uname.trim(), this.password).subscribe({
      next: (res) => {
        if (res.mustResetPassword) {
          this.router.navigateByUrl('/register');
        } else if (res.user?.roleTypeId === 5) {
          this.router.navigateByUrl('/admin');
        } else {
          this.router.navigateByUrl('/my-cases');
        }
      },
      error: (e) => {
        this.error = e?.error?.error ?? 'Login failed';
        this.busy = false;
      }
    });
  }
}
